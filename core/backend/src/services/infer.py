# ruff: noqa: E501  (the prompt is prose, one paragraph per line)
"""What the apprentice doesn't need to ask: reasons the screen or common practice already give.

At each pause the pill asks this before the apprentice speaks. For each recent screen
action, a fast model judges whether the reason is obvious from the screen, from common
business practice or from what the expert already said. Only what it is extremely sure of
(confidence >= 0.9) comes back as clear; the pill then skips the question, or tells the
apprentice "Already clear, don't ask: ..." so it asks about something else instead.

It never blocks asking: if the model can't be reached, nothing is clear and nothing is skipped.
"""

import json
import os
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from src.services.privacy import redact_deep
from src.services.work_map_edit import summary_for_agent
from src.utils.logger import logger

MODEL = os.getenv("INFER_MODEL", "gpt-4.1-mini")
# "Extremely sure": anything below is asked, not assumed.
THRESHOLD = 0.9
# The recent past is what the next question is about; older lines only slow the call down.
MAX_EVENTS = 20
MAX_LINES = 30
NOTHING = {"clear": [], "unclear": [], "skip": False}

SYSTEM = """An apprentice watches an expert do a desk task and may ask one short question now. Help it ask only what is worth asking.

You get the RECENT SCREEN actions (oldest first), the CONVERSATION so far (EXPERT and APPRENTICE) and what is ALREADY KNOWN about the task.

For each recent screen action that involved a choice, decide whether the REASON for it is obvious:
- from the screen itself (the value shown makes the choice, e.g. a total that matches the order),
- from common business practice anyone in the job would know (matching an invoice to its purchase order, checking a total before approving),
- or from what the expert already said or what is already known.

Return:
- clear: the reasons you are extremely sure of. about is the action in a few words ("cost center changed to 0400"), answer is the reason in one short sentence ("it's equipment over 5,000, so capex"), confidence is how sure you are from 0 to 1. Use 0.9 or more only when nobody in the job would doubt it; anything that depends on this company's own rules, limits, people or exceptions is never that sure.
- unclear: the actions whose reason is not obvious and worth asking about, each in a few words. Favour overrides, holds, skipped steps, ignored warnings, approvals and anything with a limit or exception.
- skip: true when nothing recent is worth a question (only navigation, routine or already answered); false otherwise.

Write about, answer and unclear in English, whatever language was spoken. Never invent what the expert said."""

SCHEMA = {
    "name": "inferred_reasons",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["clear", "unclear", "skip"],
        "properties": {
            "clear": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["about", "answer", "confidence"],
                    "properties": {
                        "about": {"type": "string"},
                        "answer": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                },
            },
            "unclear": {"type": "array", "items": {"type": "string"}},
            "skip": {"type": "boolean"},
        },
    },
}


def _known(work_map: Optional[Dict[str, Any]]) -> str:
    """The map so far as the agent reads it, plus what the apprentice recorded live."""
    if not work_map:
        return "(nothing yet)"
    parts = []
    if work_map.get("steps") or work_map.get("guardrails"):
        parts.append(summary_for_agent(dict(work_map)))
    captures = [c for c in work_map.get("captures") or [] if isinstance(c, dict)]
    if captures:
        parts.append("RECORDED LIVE\n" + json.dumps(captures[-MAX_LINES:], ensure_ascii=False))
    return "\n\n".join(parts) or "(nothing yet)"


def _parse(raw: Dict[str, Any]) -> Dict[str, Any]:
    clear, unclear = [], [str(u).strip() for u in raw.get("unclear") or [] if str(u).strip()]
    for item in raw.get("clear") or []:
        if not isinstance(item, dict):
            continue
        about = str(item.get("about") or "").strip()
        answer = str(item.get("answer") or "").strip()
        try:
            confidence = max(0.0, min(1.0, float(item.get("confidence"))))
        except (TypeError, ValueError):
            confidence = 0.0
        if not about or not answer:
            continue
        if confidence >= THRESHOLD:
            clear.append({"about": about, "answer": answer, "confidence": confidence})
        elif about not in unclear:
            # Not sure enough to assume: it is still worth asking.
            unclear.append(about)
    # Something still unclear is worth a question, whatever the model said.
    return {"clear": clear, "unclear": unclear, "skip": bool(raw.get("skip")) and not unclear}


async def infer(
    events: List[str],
    transcript: List[Dict[str, Any]],
    work_map_so_far: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """{"clear": [{"about", "answer", "confidence"}], "unclear": [str], "skip": bool}."""
    events = redact_deep([str(e) for e in events if str(e or "").strip()][-MAX_EVENTS:])
    lines = [
        line
        for line in transcript
        if isinstance(line, dict) and str(line.get("text") or "").strip()
    ]
    lines = redact_deep(lines[-MAX_LINES:])
    known = _known(redact_deep(work_map_so_far) if work_map_so_far else None)
    if not events:
        return dict(NOTHING, clear=[], unclear=[])  # nothing to judge; the apprentice decides
    screen = "\n".join(f"- {e}" for e in events)
    said = (
        "\n".join(
            f"{'EXPERT' if line.get('role') == 'expert' else 'APPRENTICE'}: {line['text']}"
            for line in lines
        )
        or "(nothing said)"
    )
    user = f"RECENT SCREEN\n{screen}\n\nCONVERSATION\n{said}\n\nALREADY KNOWN\n{known}"
    try:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = await client.chat.completions.create(
            model=MODEL,
            temperature=0,
            response_format={"type": "json_schema", "json_schema": SCHEMA},
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
        )
        return _parse(json.loads(response.choices[0].message.content))
    except Exception as e:
        logger.warning(f"[infer] couldn't judge what is already clear, asking as usual: {e}")
        return dict(NOTHING, clear=[], unclear=[])
