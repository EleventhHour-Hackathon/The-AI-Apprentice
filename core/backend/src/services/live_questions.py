"""The questions the apprentice asks while the expert works, and what kind each one is.

The brief asks for at least three live questions, one about a guardrail. The pill
counts them; this labels each one, so "about a guardrail" is checked on the question
itself rather than on what the expert happened to answer.
"""

import json
import os
from typing import Any, Dict, List

from openai import AsyncOpenAI

from src.utils.logger import logger

MODEL = os.getenv("QUESTION_KIND_MODEL", "gpt-4.1-mini")
KINDS = ("guardrail", "reason", "other")

SYSTEM = """You label one question an apprentice asked an expert while watching them work.

- guardrail: asks about a limit or threshold ("is there an amount where..."), an exception ("would you do that for every supplier?"), what they would never do, or when to stop and ask someone / who decides.
- reason: asks why they did something or what made them decide it, without asking for a limit, exception or who to ask.
- other: anything else (small talk, asking what they did, a statement)."""

SCHEMA = {
    "name": "question_kind",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["kind"],
        "properties": {"kind": {"type": "string", "enum": list(KINDS)}},
    },
}


async def classify(question: str) -> str:
    """guardrail, reason or other. Falls back to other if the model can't be reached."""
    try:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = await client.chat.completions.create(
            model=MODEL,
            temperature=0,
            response_format={"type": "json_schema", "json_schema": SCHEMA},
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}],
        )
        kind = json.loads(response.choices[0].message.content)["kind"]
        return kind if kind in KINDS else "other"
    except Exception as e:
        logger.warning(f"[live questions] could not label {question!r}: {e}")
        return "other"


def from_captures(captures: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The live questions stored with a session, in the order they were asked."""
    return [
        {
            "t": c.get("t"),
            "text": c.get("text") or "",
            "kind": c.get("question_kind") or "other",
            "deferred": bool(c.get("deferred")),
        }
        for c in captures
        if isinstance(c, dict) and c.get("kind") == "live_question"
    ]
