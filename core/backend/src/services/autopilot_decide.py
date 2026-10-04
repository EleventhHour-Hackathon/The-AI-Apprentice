"""Autopilot for the practice ERP: is one invoice routine, or a judgment call for a person?

The model sees the expert's guardrails and steps (from agent_export.to_json), the invoice and
the supplier's earlier invoices, never the supplier's contact details. It fails closed:

- only an answer of exactly "routine" lets the invoice be posted;
- "judgment" needs the id of one of the map's guardrails and a reason, otherwise the invoice
  goes to a person with NOT_CLEAR;
- a map without guardrails can't tell routine from judgment, so nothing is asked (NO_GUARDRAILS);
- any other failure goes to a person with COULD_NOT_DECIDE;
- when the model can't be used at all (no key, OpenAI unreachable) `Unavailable` is raised, so
  the caller can stop asking and say why. Nothing is posted either way.

The texts match pixel-perfect-capture/src/lib/autopilot.ts.
"""

import json
import os
from typing import Any, Awaitable, Callable, Dict, List, Optional

import openai
from openai import AsyncOpenAI

from src.services.privacy import redact, redact_deep
from src.utils.logger import logger

MODEL = os.getenv("AUTOPILOT_MODEL", "gpt-4.1")
WHY_MAX = 300

COULD_NOT_DECIDE = "The agent couldn't decide, so a person should."
NOT_CLEAR = "The agent's answer wasn't clear, so a person should."
NO_GUARDRAILS = (
    "This Work Map has no guardrails yet, so the agent can't tell routine from judgment."
)

NO_KEY = "The autopilot needs an OpenAI key (OPENAI_API_KEY) on the backend. Nothing was posted."
UNREACHABLE = "Couldn't reach OpenAI, so the autopilot can't decide. Nothing was posted."

SYSTEM = """You are an accounts-payable agent working the way an expert taught you.
You get the expert's guardrails and steps, one open invoice and the supplier's earlier invoices.

- Answer "routine" only when none of the expert's guardrails applies to this invoice.
- If any guardrail applies, or might apply, or you are unsure, answer "judgment" with that
  guardrail's id and say in one or two short sentences why, using the invoice's facts.
- Use only the expert's guardrails. Never invent rules, and never use a guardrail id that
  isn't listed.
- For "routine", guardrail_id is "" and why is a short reason."""

SCHEMA = {
    "name": "autopilot_decision",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["verdict", "guardrail_id", "why"],
        "properties": {
            "verdict": {"type": "string", "enum": ["routine", "judgment"]},
            "guardrail_id": {"type": "string"},
            "why": {"type": "string"},
        },
    },
}

INVOICE_FIELDS = (
    "id",
    "supplier",
    "country",
    "date",
    "due",
    "orderRef",
    "lines",
    "costCenter",
    "costCenterName",
    "assetNumber",
    "comment",
)
HISTORY_FIELDS = ("id", "date", "amount", "note")

Messages = List[Dict[str, str]]
Complete = Callable[[Messages], Awaitable[str]]


class Unavailable(Exception):  # noqa: N818
    """The model can't be used at all, so no invoice can be decided."""


def _judgment(why: str, guardrail_id: Optional[str] = None) -> Dict[str, Any]:
    return {"verdict": "judgment", "guardrailId": guardrail_id, "why": why}


def prompt(
    invoice: Dict[str, Any], history: List[Dict[str, Any]], export: Dict[str, Any]
) -> Messages:
    """The messages for the model. Only the listed invoice fields go in, so never a contact."""
    guardrails = [
        {
            "id": g.get("id", ""),
            "kind": g.get("kind", ""),
            "rule": g.get("rule", ""),
            "applies_when": g.get("applies_when", ""),
            "ask_whom": g.get("ask_whom", ""),
            "expert_words": g.get("expert_words_english") or g.get("expert_words", ""),
        }
        for g in export.get("guardrails") or []
    ]
    steps = [
        {
            "title": s.get("title", ""),
            "decision": s.get("decision", ""),
            "judgment": bool(s.get("judgment")),
        }
        for s in export.get("steps") or []
    ]
    case = {
        "guardrails": guardrails,
        "steps": steps,
        "invoice": {k: invoice[k] for k in INVOICE_FIELDS if k in invoice},
        "supplier_history": [
            {k: h[k] for k in HISTORY_FIELDS if k in h} for h in history if isinstance(h, dict)
        ],
    }
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": json.dumps(redact_deep(case), ensure_ascii=False)},
    ]


def parse(text: str, guardrail_ids: List[str]) -> Dict[str, Any]:
    """The model's answer as a Decision; anything but a clear answer goes to a person."""
    try:
        answer = json.loads(text)
    except (TypeError, ValueError):
        return _judgment(NOT_CLEAR)
    if not isinstance(answer, dict):
        return _judgment(NOT_CLEAR)
    verdict = answer.get("verdict")
    if verdict == "routine":
        return {"verdict": "routine"}
    guardrail_id, why = answer.get("guardrail_id"), answer.get("why")
    if (
        verdict != "judgment"
        or not isinstance(guardrail_id, str)
        or guardrail_id not in guardrail_ids
        or not isinstance(why, str)
        or not why.strip()
    ):
        return _judgment(NOT_CLEAR)
    return _judgment(redact(why.strip()[:WHY_MAX]), guardrail_id)


async def _openai_complete(messages: Messages) -> str:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise Unavailable(NO_KEY)
    try:
        # No retries: the UI gives up on an invoice after 20 s too.
        client = AsyncOpenAI(api_key=key, timeout=20, max_retries=0)
        response = await client.chat.completions.create(
            model=MODEL,
            temperature=0,
            response_format={"type": "json_schema", "json_schema": SCHEMA},
            messages=messages,
        )
    except openai.APIConnectionError as e:  # APITimeoutError is one too
        logger.warning(f"[autopilot] OpenAI unreachable: {e}")
        raise Unavailable(UNREACHABLE) from e
    return response.choices[0].message.content


async def decide(
    invoice: Dict[str, Any],
    history: List[Dict[str, Any]],
    export: Dict[str, Any],
    complete: Optional[Complete] = None,
) -> Dict[str, Any]:
    """Routine or judgment for one invoice. Raises Unavailable when the model can't be used."""
    ids = [g.get("id") for g in export.get("guardrails") or [] if g.get("id")]
    if not ids:
        return _judgment(NO_GUARDRAILS)
    try:
        text = await (complete or _openai_complete)(prompt(invoice, history, export))
        return parse(text, ids)
    except Unavailable:
        raise
    except Exception as e:
        logger.warning(f"[autopilot] could not decide invoice {invoice.get('id')!r}: {e}")
        return _judgment(COULD_NOT_DECIDE)
