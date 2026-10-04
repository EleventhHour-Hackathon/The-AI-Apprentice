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

from src.services import languages
from src.services import work_map_links as links
from src.services.work_map_edit import summary_for_agent
from src.utils.logger import logger

MODEL = os.getenv("MERGE_MODEL", "gpt-4.1")

SYSTEM = """You turn a recorded work session into a Work Map: the steps an expert took, the judgment behind them and the guardrails around them, so a new hire could do the task.

You get:
- SCREEN: what changed on the expert's screen, each line "mm:ss event".
- TRANSCRIPT: the conversation between the EXPERT and the APPRENTICE, each line "mm:ss SPEAKER: words".
- CAPTURES: what the apprentice recorded live (may be incomplete or duplicated).

Build:
- steps: the task in order, one per action seen on SCREEN. A step's title is the action in general terms that would apply to any case ("Code the invoice to a cost center", "Check the asset number"), never this case's numbers; the specific values go in decision. Opening, viewing or switching to a document is never a step on its own; fold it into the action that follows. Checking, coding, holding, approving, sending, saving are steps. For each:
  - at: the mm:ss of the SCREEN line where it happened: the decisive moment.
  - start: the mm:ss of the first SCREEN line of this subtask, where the expert began it (including the opening or navigating folded into it); at or before at, and after the previous step's end.
  - end: the mm:ss of the SCREEN line where it was done and its result showed (saved, sent, field filled); at or after at, and before the next step's start. start and end may equal at for a one-moment step.
  - screen: what was on screen then, in a few words ("invoice 4471, cost center field").
  - decision: the specific choice, with real values ("re-coded from 4711 to 0400"); "" if routine.
  - reason: why, in the expert's words, only if they gave it; "" if nobody said.
  - quote: the expert's exact words that give the reason, copied verbatim from TRANSCRIPT; "" if none.
  - judgment: true when the step needed a decision a new hire could get wrong, false for routine steps.
  - inferred_reason: only when reason is "": the reason, in one short sentence, if it is obvious from the screen or from common business practice anyone in the job would know; "" otherwise. Never a reason that depends on this company's own rules, limits, people or exceptions.
  - inferred_confidence: how sure you are of inferred_reason, from 0 to 1; 0 when it is "". Use 0.9 or more only when nobody in the job would doubt it.
- guardrails: every limit, exception or moment to stop and ask someone the expert stated. kind is limit (a threshold or hard rule), exception (a case handled differently) or stop_and_ask (someone else must decide, approve or be asked: a controller, manager, colleague); for stop_and_ask, ask_whom names them. step is the id of the step it is about: every guardrail belongs to a step whenever one fits, including rules first stated in the debrief; leave it empty only for a rule about the whole task. quote is verbatim from TRANSCRIPT. at is the mm:ss of the SCREEN moment it is about (the step's moment if it was only said in the debrief).
- open_questions: what is still unclear.
MODE_RULES

Rules:
- Write everything in English, whatever language was spoken: titles, screen, decision, reason, rule, applies_when, ask_whom and open_questions. Only quote stays exactly as the expert said it, in the language they said it, never translated.
- Never invent a reason, rule or quote. Only the EXPERT's words count; the APPRENTICE's questions are not reasons.
- A correction from the teach-back overrides what was said before.
- Keep wording short and concrete, with the real values from the screen."""  # noqa: E501

DRAFT_RULES = """  This is the DRAFT, before the debrief. List every question still worth asking, most valuable first; there is no fixed number, include at least three: steps with a decision but no reason, edges of the guardrails (larger amounts, new or foreign suppliers, missing data, who to ask), and cases that were never shown. Each is one short spoken question about the judgment behind the work: why, when it would be different, where the limit is, who they would ask. Never ask the expert to describe or repeat what they did or said, and never restate the task or the screen back to them ("What steps do you take to debug code after seeing the test summary?" is a bad question; "What would make you stop and ask someone before changing it?" is a good one). If little was shown, ask about the edges of the task in general: the cases handled differently, the moments to stop and ask, what a new person gets wrong. Do not repeat questions the expert already answered. Do not ask why a step was done when you gave it an inferred_reason with inferred_confidence 0.9 or more: it is assumed, and the teach-back states it for the expert to confirm."""

FINAL_RULES = """  This is the FINAL map, after the debrief and teach-back. List only what is genuinely still unanswered (often nothing)."""

_QUOTE = {"type": "string"}
SCHEMA = {
    "name": "work_map",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["task", "steps", "guardrails", "open_questions"],
        "properties": {
            "task": {
                "type": "string",
                "description": "The task in a few English words, as the expert named it (translated if they spoke another language)",
            },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "id",
                        "title",
                        "at",
                        "start",
                        "end",
                        "screen",
                        "decision",
                        "reason",
                        "quote",
                        "judgment",
                        "inferred_reason",
                        "inferred_confidence",
                    ],
                    "properties": {
                        "id": {"type": "string", "description": "s1, s2, ..."},
                        "title": {"type": "string"},
                        "at": {"type": "string", "description": "mm:ss"},
                        "start": {"type": "string", "description": "mm:ss, first screen moment of the subtask"},
                        "end": {"type": "string", "description": "mm:ss, screen moment the subtask was done"},
                        "screen": {"type": "string"},
                        "decision": {"type": "string"},
                        "reason": {"type": "string"},
                        "quote": _QUOTE,
                        "judgment": {"type": "boolean"},
                        "inferred_reason": {"type": "string"},
                        "inferred_confidence": {"type": "number"},
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


mmss = links.mmss

# A reason nobody said is kept only if the merge is "extremely sure" of it (see infer.THRESHOLD).
INFERRED_THRESHOLD = 0.9


def _assume_reason(step: Dict[str, Any]) -> None:
    """Keep a reason the merge is extremely sure of as an assumed one (reason_source "inferred"),
    so the debrief doesn't ask it and the teach-back states it for the expert to confirm."""
    inferred = str(step.pop("inferred_reason", "") or "").strip()
    try:
        confidence = float(step.pop("inferred_confidence", 0) or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    if inferred and confidence >= INFERRED_THRESHOLD and not str(step.get("reason") or "").strip():
        step.update(reason=inferred, reason_source="inferred")


def assumed(step: Dict[str, Any]) -> bool:
    return step.get("reason_source") == "inferred"


def _dedupe(questions: List[str]) -> List[str]:
    """Drop blank and repeated questions (ignoring case), keeping the first."""
    seen, out = set(), []
    for q in questions:
        key = (q or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(q.strip())
    return out


def _seconds(value: str) -> Optional[float]:
    match = re.fullmatch(r"\s*(\d+):(\d{1,2})\s*", value or "")
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def _ground_quote(item: Dict[str, Any], expert_lines: List[Dict[str, Any]]) -> None:
    """Keep a quote only if the expert said it (see work_map_links.match_quote)."""
    proposed = item.get("quote")
    if not links.ground_quote(item, expert_lines) and proposed:
        logger.info(f"Dropping a quote the expert never said: {proposed!r}")


def _snap(at: Optional[float], events: List[Dict[str, Any]]) -> Optional[float]:
    """Move a time onto the nearest real screen event, so it always has a screen moment."""
    if not events:
        return at
    if at is None:
        return None
    return min((e["t"] for e in events), key=lambda t: abs(t - at))


def _span(step: Dict[str, Any], events: List[Dict[str, Any]]) -> None:
    """Snap when the subtask began and ended to screen events, around its decisive moment."""
    at = step["at"]
    start = _snap(_seconds(step.get("start", "")), events)
    end = _snap(_seconds(step.get("end", "")), events)
    if at is None:
        step["start"] = step["end"] = None
        return
    step["start"] = min(start, at) if start is not None else at
    step["end"] = max(end, at) if end is not None else at


def _separate(steps: List[Dict[str, Any]]) -> None:
    """Make neighbouring subtasks not overlap: a step ends where the next one starts, and
    never runs past the next step's decisive moment nor starts before the previous one's."""
    timed = sorted((s for s in steps if s.get("at") is not None), key=lambda s: s["at"])
    for before, after in zip(timed, timed[1:]):
        before["end"] = min(before["end"], after["at"])
        after["start"] = max(after["start"], before["at"])
        if before["end"] > after["start"]:
            before["end"] = after["start"]


async def merge(
    *,
    task: Optional[str],
    events: List[Dict[str, Any]],
    transcript: List[Dict[str, Any]],
    captures: List[Dict[str, Any]],
    final: bool,
) -> Dict[str, Any]:
    """Return {"task", "steps", "guardrails", "open_questions"} for the session."""
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
    live_lines = [l for l in expert_lines if (l.get("phase") or "live") == "live"]
    steps = {s["id"]: s for s in work_map["steps"]}
    for step in work_map["steps"]:
        _assume_reason(step)
        step["at"] = _snap(_seconds(step["at"]), events)
        _span(step, events)
        _ground_quote(step, expert_lines)
    _separate(work_map["steps"])
    # Every step gets the expert's words: the reason if they gave one, else what they said doing it.
    for step in work_map["steps"]:
        links.narrate(step, live_lines)
    for guard in work_map["guardrails"]:
        if guard["step"] not in steps:
            guard["step"] = ""
        _ground_quote(guard, expert_lines)
        links.place_guardrail(guard, steps, events, _snap(_seconds(guard["at"]), events))
    # Quotes stay in the expert's language; the map shows an English translation beside them.
    await languages.translate_quotes([*work_map["steps"], *work_map["guardrails"]])
    # Whatever is still unlinked becomes a question: in the draft it is asked first in the
    # debrief; in the final map it stays open instead of only being flagged.
    # A step with an assumed reason isn't asked about: the teach-back states it instead.
    asked_steps = [s for s in work_map["steps"] if not assumed(s)]
    gaps = links.unlinked_gaps({**work_map, "steps": asked_steps})
    asked = _dedupe(work_map["open_questions"])
    work_map["open_questions"] = _dedupe([*asked, *gaps] if final else [*gaps, *asked])
    if gaps:
        added = len(work_map["open_questions"]) - len(asked)
        logger.info(f"Added {added} open questions for Work Map items without a moment or words")

    logger.info(
        f"Merged {'final' if final else 'draft'} Work Map: {len(work_map['steps'])} steps, "
        f"{len(work_map['guardrails'])} guardrails, {len(work_map['open_questions'])} open"
    )
    return work_map


def brief_for_agent(work_map: Dict[str, Any]) -> str:
    """What start_debrief hands back to the agent: the draft, and the gaps to ask about first."""
    gaps = "\n".join(f"- {q}" for q in work_map["open_questions"]) or "- none"
    brief = (
        f"DRAFT WORK MAP (ids are for edit_work_map)\n{summary_for_agent(work_map)}\n\n"
        f"GAPS TO ASK ABOUT FIRST, one at a time. These are notes, not a script: ask each in your own "
        f"words, in one short sentence, without restating what the expert said or did:\n{gaps}"
    )
    inferred = [s for s in work_map.get("steps") or [] if assumed(s)]
    if inferred:
        lines = "\n".join(f"- {s.get('id')} {s.get('title')}: {s.get('reason')}" for s in inferred)
        brief += (
            "\n\nASSUMED REASONS: nobody said these; they are obvious from the screen or common "
            f"practice. Do not ask them; state them as assumptions in the teach-back:\n{lines}"
        )
    return brief
