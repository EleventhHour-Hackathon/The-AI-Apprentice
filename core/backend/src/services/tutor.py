"""Teaching a new hire from a Work Map.

Three pieces the tutor agent can't do reliably on its own:

- work_map_text: the Work Map as the tutor (and the checker) read it, with ids.
- check: after each thing the new hire does on screen, compare it with the
  expert's steps and guardrails, applied to *this* case's values, and say
  whether to step in before it is saved.
- report: what they mastered and what to practice, from what actually
  happened in the lesson rather than the tutor's impression.
"""

import json
import os
from typing import Any, Dict, List

from openai import AsyncOpenAI

from src.services.work_map_merge import mmss
from src.utils.logger import logger

MODEL = os.getenv("TUTOR_CHECK_MODEL", "gpt-4.1")

GUARD_KIND = {"limit": "Limit", "exception": "Exception", "stop_and_ask": "Stop and ask"}


def _step_title(step: Dict[str, Any]) -> str:
    return step.get("title") or step.get("step") or ""


def _in_english(item: Dict[str, Any]) -> str:
    """The English translation of a quote the expert gave in another language."""
    return f' (in English: "{item["quote_translation"]}")' if item.get("quote_translation") else ""


def work_map_text(work_map: Dict[str, Any]) -> str:
    lines = ["STEPS (in order)"]
    for i, s in enumerate(work_map.get("steps") or [], 1):
        sid = s.get("id") or f"s{i}"
        line = f"{sid}. {_step_title(s)}"
        if s.get("judgment"):
            line += " [judgment call]"
        if s.get("decision"):
            line += f"\n   Decision the expert made on their case: {s['decision']}"
        narration = s.get("quote_kind") == "narration"
        if s.get("quote") and not narration:
            line += f'\n   Expert\'s words: "{s["quote"]}"{_in_english(s)}'
        elif s.get("reason"):
            # A reason the merge assumed (work_map_merge), not one the expert gave.
            label = "Assumed reason" if s.get("reason_source") == "inferred" else "Reason"
            line += f"\n   {label}: {s['reason']}"
        if s.get("quote") and narration:
            # What they said while doing it: context, not a reason to teach.
            line += f'\n   Said while doing it (not a reason): "{s["quote"]}"{_in_english(s)}'

        lines.append(line)
    lines.append("\nGUARDRAILS")
    for i, g in enumerate(work_map.get("guardrails") or [], 1):
        gid = g.get("id") or f"g{i}"
        kind = GUARD_KIND.get(g.get("kind", ""), "Rule")
        line = f"{gid}. {kind}: {g.get('rule', '')}"
        if g.get("step"):
            line += f" (step {g['step']})"
        if g.get("applies_when"):
            line += f"\n   Applies when: {g['applies_when']}"
        if g.get("ask_whom"):
            line += f"\n   Ask: {g['ask_whom']}"
        if g.get("quote"):
            line += f'\n   Expert\'s words: "{g["quote"]}"{_in_english(g)}'
        lines.append(line)
    if len(lines) == 2:
        lines.append("(none)")
    return "\n".join(lines)


CHECK_SYSTEM = """You watch a new hire work a case on screen and compare what they do with an expert's Work Map.

The new hire works a DIFFERENT case from the one the expert showed. Do not compare values literally: apply the expert's rules and guardrails to the values on this case. For example, if the expert said "equipment over 5,000 is always capex (0400)", a 7,200 equipment invoice coded to opex 4711 is wrong, even though the expert's own invoice had other numbers.

You get the Work Map, what happened on the new hire's screen so far (oldest first), the LATEST event, and any problems already flagged and not yet fixed.

Judge only the LATEST event:
- "intervene": it enters a value or makes a choice the expert's rules say is wrong for this case, or it saves, approves or sends something while a guardrail says to stop first (missing data, a limit, someone to ask). Catch it now, before it is final.
- "fixed": it corrects one of the already-flagged problems.
- "ok": it is a step done the way the expert does it.
- "none": nothing to judge (opening, viewing, scrolling, or not covered by the Work Map).

A confirmation or review dialog before saving, posting, approving or sending is the last moment to step in: judge the values it shows (including ones that were pre-filled and never changed) and intervene if the expert's rules say they are wrong for this case. Merely opening a record with wrong pre-filled values is "none"; the mistake is going ahead with them.

Only intervene when the Work Map clearly says so; never on a hunch, and never twice for the same flagged problem.

Also give next_step: the id of the judgment-call step the new hire is about to face, given what is open on screen now, or "" if none or unclear.

what_happened and expected are short and concrete, with the real values from this case."""

CHECK_SCHEMA = {
    "name": "check",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["verdict", "step", "guardrail", "what_happened", "expected", "next_step"],
        "properties": {
            "verdict": {"type": "string", "enum": ["intervene", "fixed", "ok", "none"]},
            "step": {"type": "string", "description": "step id the event belongs to, or empty"},
            "guardrail": {"type": "string", "description": "guardrail id that is broken, or empty"},
            "what_happened": {"type": "string"},
            "expected": {"type": "string", "description": "what the expert would do here, or empty"},
            "next_step": {"type": "string"},
        },
    },
}


async def check(
    work_map: Dict[str, Any],
    history: List[Dict[str, Any]],
    event: str,
    open_flags: List[Dict[str, Any]],
) -> Dict[str, Any]:
    seen = "\n".join(f"{mmss(e.get('t'))} {e.get('event')}" for e in history) or "(nothing yet)"
    flags = "\n".join(f"- step {f.get('step')}: {f.get('what_happened')}" for f in open_flags) or "(none)"
    user = (
        f"WORK MAP\n{work_map_text(work_map)}\n\nNEW HIRE'S SCREEN SO FAR\n{seen}\n\n"
        f"ALREADY FLAGGED, NOT YET FIXED\n{flags}\n\nLATEST EVENT\n{event}"
    )
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = await client.chat.completions.create(
        model=MODEL,
        temperature=0,
        response_format={"type": "json_schema", "json_schema": CHECK_SCHEMA},
        messages=[{"role": "system", "content": CHECK_SYSTEM}, {"role": "user", "content": user}],
    )
    result = json.loads(response.choices[0].message.content)

    # Only ids that exist in the map; a verdict about a step we can't name can't be taught.
    step_ids = {s.get("id") for s in work_map.get("steps") or []}
    guard_ids = {g.get("id") for g in work_map.get("guardrails") or []}
    for key, valid in (("step", step_ids), ("next_step", step_ids), ("guardrail", guard_ids)):
        if result[key] not in valid:
            result[key] = ""
    if result["verdict"] in ("intervene", "ok", "fixed") and not result["step"]:
        result["verdict"] = "none"
    logger.info(f"Tutor check: {result['verdict']} {result['step']} {result['guardrail']} | {event}")
    return result


def report(work_map: Dict[str, Any], attempts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Mastered, practice next and not covered, per step, from what happened in the lesson."""
    mastered, practice, not_covered = [], [], []
    for i, step in enumerate(work_map.get("steps") or [], 1):
        sid = step.get("id") or f"s{i}"
        mine = [a for a in attempts if a.get("step") == sid]
        caught = [a for a in mine if a.get("type") == "intervention"]
        fixed = any(a.get("type") == "fixed" for a in mine)
        wrong_guess = [a for a in mine if a.get("type") == "prediction" and not a.get("correct")]
        right = any(a.get("type") == "done" for a in mine) or any(
            a.get("type") == "prediction" and a.get("correct") for a in mine
        )
        entry = {"step": sid, "title": _step_title(step)}
        if caught or wrong_guess:
            why = []
            if caught:
                why.append(f"Caught before saving: {caught[0].get('what_happened') or 'a wrong decision'}")
                if fixed:
                    why.append("fixed after the tutor stepped in")
            if wrong_guess:
                why.append(f"Predicted \"{wrong_guess[0].get('answer') or 'something else'}\"")
            practice.append(
                {
                    **entry,
                    "why": "; ".join(why) + ".",
                    "expected": caught[0].get("expected", "") if caught else step.get("decision", ""),
                    "expert_words": (step.get("quote") if step.get("quote_kind") != "narration" else "")
                    or step.get("reason")
                    or "",
                }
            )
        elif right:
            mastered.append(entry)
        else:
            not_covered.append(entry)

    summary = (
        f"Mastered: {', '.join(m['title'] for m in mastered) or 'nothing yet'}. "
        f"Practice next: {'; '.join(p['title'] + ' (' + p['why'] + ')' for p in practice) or 'nothing'}. "
        f"Not covered by this case: {', '.join(n['title'] for n in not_covered) or 'nothing'}."
    )
    return {"mastered": mastered, "practice": practice, "not_covered": not_covered, "summary": summary}
