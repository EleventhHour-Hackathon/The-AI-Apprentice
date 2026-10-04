"""Merge a session into a Work Map.

What the vision model saw (screen events), what was said (transcript) and what
the agent recorded live (captures) are merged by an LLM into steps and
guardrails, each tied to a screen moment and the expert's own words, plus the
gaps still to ask about. Runs once when the work ends (draft, which drives the
debrief) and again after the teach-back is confirmed (final).

The LLM is not trusted with the parts that make the map believable: quotes
must appear in what the expert actually said, and times are snapped to real
screen events.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from src.utils.logger import logger

MODEL = os.getenv("MERGE_MODEL", "gpt-4.1")

SYSTEM = """You turn a recorded work session into a Work Map: the steps an expert took, the judgment behind them and the guardrails around them, so a new hire could do the task.

You get:
- SCREEN: what changed on the expert's screen, each line "mm:ss event".
- TRANSCRIPT: the conversation between the EXPERT and the APPRENTICE, each line "mm:ss SPEAKER: words".
- CAPTURES: what the apprentice recorded live (may be incomplete or duplicated).

Build:
- steps: the task in order, one per action seen on SCREEN. A step's title is the action in general terms that would apply to any case ("Code the invoice to a cost center", "Check the asset number"), never this case's numbers; the specific values go in decision. Opening, viewing or switching to a document is never a step on its own; fold it into the action that follows. Checking, coding, holding, approving, sending, saving are steps. For each:
  - at: the mm:ss of the SCREEN line where it happened.
  - screen: what was on screen then, in a few words ("invoice 4471, cost center field").
  - decision: the specific choice, with real values ("re-coded from 4711 to 0400"); "" if routine.
  - reason: why, in the expert's words, only if they gave it; "" if nobody said.
  - quote: the expert's exact words that give the reason, copied verbatim from TRANSCRIPT; "" if none.
  - judgment: true when the step needed a decision a new hire could get wrong, false for routine steps.
- guardrails: every limit, exception or moment to stop and ask someone the expert stated. kind is limit (a threshold or hard rule), exception (a case handled differently) or stop_and_ask (someone else must decide, approve or be asked: a controller, manager, colleague); for stop_and_ask, ask_whom names them. step is the id of the step it belongs to. quote is verbatim from TRANSCRIPT. at is the mm:ss of the related SCREEN moment.
- open_questions: what is still unclear.
MODE_RULES

Rules:
- Never invent a reason, rule or quote. Only the EXPERT's words count; the APPRENTICE's questions are not reasons.
- A correction from the teach-back overrides what was said before.
- Keep wording short and concrete, with the real values from the screen."""

DRAFT_RULES = """  This is the DRAFT, before the debrief. List 3 to 6 questions the apprentice should ask now, most valuable first: steps with a decision but no reason, edges of the guardrails (larger amounts, new or foreign suppliers, missing data, who to ask), and cases that were never shown. Each is one short spoken question about the judgment behind the work: why, when it would be different, where the limit is, who they would ask. Never ask the expert to describe or repeat what they did or said, and never restate the task or the screen back to them ("What steps do you take to debug code after seeing the test summary?" is a bad question; "What would make you stop and ask someone before changing it?" is a good one). If little was shown, ask about the edges of the task in general: the cases handled differently, the moments to stop and ask, what a new person gets wrong. Do not repeat questions the expert already answered."""

FINAL_RULES = """  This is the FINAL map, after the debrief and teach-back. List only what is genuinely still unanswered (often nothing)."""

_QUOTE = {"type": "string"}
SCHEMA = {
    "name": "work_map",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["steps", "guardrails", "open_questions"],
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "title", "at", "screen", "decision", "reason", "quote", "judgment"],
                    "properties": {
                        "id": {"type": "string", "description": "s1, s2, ..."},
                        "title": {"type": "string"},
                        "at": {"type": "string", "description": "mm:ss"},
                        "screen": {"type": "string"},
                        "decision": {"type": "string"},
                        "reason": {"type": "string"},
                        "quote": _QUOTE,
                        "judgment": {"type": "boolean"},
                    },
                },
            },
            "guardrails": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "step", "kind", "rule", "applies_when", "ask_whom", "quote", "at"],
                    "properties": {
                        "id": {"type": "string", "description": "g1, g2, ..."},
                        "step": {"type": "string", "description": "id of the step, or empty"},
                        "kind": {"type": "string", "enum": ["limit", "exception", "stop_and_ask"]},
                        "rule": {"type": "string"},
                        "applies_when": {"type": "string"},
                        "ask_whom": {"type": "string"},
                        "quote": _QUOTE,
                        "at": {"type": "string", "description": "mm:ss"},
                    },
                },
            },
            "open_questions": {"type": "array", "items": {"type": "string"}},
        },
    },
}


def mmss(seconds: Optional[float]) -> str:
    s = max(0, int(seconds or 0))
    return f"{s // 60:02d}:{s % 60:02d}"


def _seconds(value: str) -> Optional[float]:
    match = re.fullmatch(r"\s*(\d+):(\d{1,2})\s*", value or "")
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def _normal(text: str) -> str:
    return re.sub(r"[^a-z0-9€$%]+", " ", (text or "").lower()).strip()


def _ground_quote(item: Dict[str, Any], expert_lines: List[Dict[str, Any]]) -> None:
    """Keep a quote only if the expert said it, and record when and in which phase."""
    quote = _normal(item.get("quote", ""))
    line = next((l for l in expert_lines if quote and quote in _normal(l["text"])), None)
    if not line:
        if item.get("quote"):
            logger.info(f"Dropping a quote the expert never said: {item['quote']!r}")
        item.update(quote="", quote_at=None, quote_source="none")
        return
    item.update(quote_at=line["t"], quote_source=line.get("phase") or "live")


def _snap(at: Optional[float], events: List[Dict[str, Any]]) -> Optional[float]:
    """Move a time onto the nearest real screen event, so it always has a screen moment."""
    if not events:
        return at
    if at is None:
        return None
    return min((e["t"] for e in events), key=lambda t: abs(t - at))


async def merge(
    *,
    task: Optional[str],
    events: List[Dict[str, Any]],
    transcript: List[Dict[str, Any]],
    captures: List[Dict[str, Any]],
    final: bool,
) -> Dict[str, Any]:
    """Return {"steps", "guardrails", "open_questions"} for the session."""
    screen = "\n".join(f"{mmss(e['t'])} {e['event']}" for e in events) or "(nothing seen)"
    said = "\n".join(
        f"{mmss(line.get('t'))} {'EXPERT' if line['role'] == 'expert' else 'APPRENTICE'}: {line['text']}"
        for line in transcript
    ) or "(nothing said)"
    user = (
        f"TASK: {task or 'unknown'}\n\nSCREEN:\n{screen}\n\nTRANSCRIPT:\n{said}\n\n"
        f"CAPTURES:\n{json.dumps(captures, ensure_ascii=False)}"
    )
    system = SYSTEM.replace("MODE_RULES", FINAL_RULES if final else DRAFT_RULES)

    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = await client.chat.completions.create(
        model=MODEL,
        temperature=0.2,
        response_format={"type": "json_schema", "json_schema": SCHEMA},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    work_map = json.loads(response.choices[0].message.content)

    expert_lines = [l for l in transcript if l["role"] == "expert"]
    step_ids = {s["id"] for s in work_map["steps"]}
    for step in work_map["steps"]:
        step["at"] = _snap(_seconds(step["at"]), events)
        _ground_quote(step, expert_lines)
    for guard in work_map["guardrails"]:
        guard["at"] = _snap(_seconds(guard["at"]), events)
        if guard["step"] not in step_ids:
            guard["step"] = ""
        _ground_quote(guard, expert_lines)

    logger.info(
        f"Merged {'final' if final else 'draft'} Work Map: {len(work_map['steps'])} steps, "
        f"{len(work_map['guardrails'])} guardrails, {len(work_map['open_questions'])} open"
    )
    return work_map


def brief_for_agent(work_map: Dict[str, Any]) -> str:
    """What start_debrief hands back to the agent: the draft, and the gaps to ask about first."""
    steps = "\n".join(
        f"{i}. [{mmss(s['at'])}] {s['title']}"
        + (f": {s['decision']}" if s["decision"] else "")
        + (f" (reason: {s['reason']})" if s["reason"] else " (reason unknown)")
        for i, s in enumerate(work_map["steps"], 1)
    )
    guards = "\n".join(f"- {g['kind']}: {g['rule']}" for g in work_map["guardrails"]) or "- none yet"
    gaps = "\n".join(f"- {q}" for q in work_map["open_questions"]) or "- none"
    return (
        f"DRAFT WORK MAP\nSteps:\n{steps or '(none)'}\nGuardrails:\n{guards}\n\n"
        f"GAPS TO ASK ABOUT FIRST, one at a time. These are notes, not a script: ask each in your own "
        f"words, in one short sentence, without restating what the expert said or did:\n{gaps}"
    )
