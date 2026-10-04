"""Questions kept for an expert's next session, stored as captures on their Work Map.

A question from the compare page ("Ask the expert of Session A ...") is appended to that expert's
Work Map as a capture. Withdrawing or delivering it appends another capture; the list is never
rewritten. `pending` and `for_merge` are the only readers.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

QUESTION = "follow_up_question"
WITHDRAWN = "follow_up_withdrawn"
DELIVERED = "follow_up_delivered"
PARENT = "parent"

# Captures that aren't what the apprentice learned: the merge never sees them.
NOT_FOR_MERGE = frozenset({"live_question", QUESTION, WITHDRAWN, DELIVERED, PARENT})


def _at(now: datetime) -> str:
    return now.isoformat(timespec="seconds")


def capture(question: Dict[str, Any], from_id: str, now: datetime) -> Dict[str, Any]:
    """A QUESTION capture from an already validated and redacted {"id", "text", "quote"}."""
    return {
        "kind": QUESTION,
        "question_id": question["id"],
        "text": question["text"],
        "quote": question.get("quote") or "",
        "from": from_id,
        "added_at": _at(now),
    }


def closed(
    question_id: str, kind: str, now: datetime, session: Optional[str] = None
) -> Dict[str, Any]:
    """A WITHDRAWN or DELIVERED capture (DELIVERED names the session that asked the question)."""
    if kind not in (WITHDRAWN, DELIVERED):
        raise ValueError(f"Not a closing kind: {kind}")
    closing: Dict[str, Any] = {"kind": kind, "question_id": question_id, "at": _at(now)}
    if kind == DELIVERED:
        closing["session"] = session or ""
    return closing


def pending(captures: List[Any]) -> List[Dict[str, Any]]:
    """The questions still waiting, oldest first: added and not withdrawn or delivered since."""
    waiting: Dict[str, Dict[str, Any]] = {}  # insertion order is the add order
    for c in captures or []:
        if not isinstance(c, dict):
            continue
        kind = c.get("kind")
        question_id = c.get("question_id")
        if not isinstance(question_id, str):
            continue
        if kind == QUESTION:
            # First one wins, so a double post from a race is harmless.
            if question_id not in waiting:
                waiting[question_id] = {
                    "question_id": question_id,
                    "text": c.get("text") or "",
                    "quote": c.get("quote") or "",
                    "from": c.get("from") or "",
                    "added_at": c.get("added_at") or "",
                }
        elif kind in (WITHDRAWN, DELIVERED):
            waiting.pop(question_id, None)
    return list(waiting.values())


def for_merge(captures: List[Any]) -> List[Dict[str, Any]]:
    """The captures the Work Map merge should see: what the agent recorded, nothing else."""
    return [c for c in captures or [] if isinstance(c, dict) and c.get("kind") not in NOT_FOR_MERGE]
