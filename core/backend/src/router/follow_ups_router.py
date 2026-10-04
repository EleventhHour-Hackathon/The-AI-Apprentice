from datetime import datetime, timezone
from typing import Any, Dict, List
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.router.path_router import _store_unavailable, _uuid
from src.services import follow_ups, privacy
from storage import work_maps as work_map_store

router = APIRouter(prefix="/api/v1", tags=["Follow-up questions"])


class FollowUpIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=1, max_length=300)
    quote: str = Field("", max_length=300)
    from_work_map_id: str


class FollowUpsIn(BaseModel):
    questions: List[FollowUpIn] = Field(..., min_length=1, max_length=10)


def _work_map(work_map_id: str) -> Dict[str, Any]:
    try:
        work_map = work_map_store.get(work_map_id)
    except Exception as e:
        raise _store_unavailable(e) from e
    if work_map is None:
        raise HTTPException(status_code=404, detail="Work Map not found")
    return work_map


def _cleaned(question: FollowUpIn, work_map_id: str) -> Dict[str, Any]:
    """The question stripped and redacted, with the canonical id of the Work Map it came from."""
    text = question.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="A question needs its text")
    try:
        from_id = str(uuid.UUID(question.from_work_map_id))
    except ValueError:
        raise HTTPException(
            status_code=422, detail="from_work_map_id is not a Work Map id"
        ) from None
    if from_id == work_map_id:
        raise HTTPException(status_code=422, detail="A question can't come from the same Work Map")
    return {
        "id": question.id,
        "text": privacy.redact(text),
        "quote": privacy.redact(question.quote.strip()),
        "from": from_id,
    }


@router.post("/work_maps/{work_map_id}/follow_up_questions")
def add_follow_up_questions(work_map_id: str, body: FollowUpsIn) -> Dict[str, Any]:
    """Keep questions for this expert's next session. Ones already waiting aren't added twice."""
    work_map_id = _uuid(work_map_id, "Work Map")
    questions = [_cleaned(q, work_map_id) for q in body.questions]
    captures = _work_map(work_map_id).get("captures") or []
    waiting = {q["question_id"] for q in follow_ups.pending(captures)}
    now = datetime.now(timezone.utc)
    added: List[str] = []
    for q in questions:
        if q["id"] in waiting:
            continue
        new = follow_ups.capture(q, q["from"], now)
        try:
            found = work_map_store.add_capture(work_map_id, new)
        except Exception as e:
            raise _store_unavailable(e) from e
        if not found:
            raise HTTPException(status_code=404, detail="Work Map not found")
        waiting.add(q["id"])
        added.append(q["id"])
        captures = [*captures, new]
    return {"added": added, "questions": follow_ups.pending(captures)}


@router.get("/work_maps/{work_map_id}/follow_up_questions")
def list_follow_up_questions(work_map_id: str) -> Dict[str, Any]:
    """The questions waiting for this expert's next session, oldest first."""
    work_map_id = _uuid(work_map_id, "Work Map")
    return {"questions": follow_ups.pending(_work_map(work_map_id).get("captures") or [])}


@router.delete("/work_maps/{work_map_id}/follow_up_questions")
def withdraw_follow_up_question(
    work_map_id: str, question_id: str = Query(..., min_length=1, max_length=200)
) -> Dict[str, Any]:
    """Withdraw a waiting question. Ids contain ":", so it comes as a query parameter."""
    work_map_id = _uuid(work_map_id, "Work Map")
    captures = _work_map(work_map_id).get("captures") or []
    if question_id not in {q["question_id"] for q in follow_ups.pending(captures)}:
        raise HTTPException(status_code=404, detail="No such question waiting")
    withdrawn = follow_ups.closed(question_id, follow_ups.WITHDRAWN, datetime.now(timezone.utc))
    try:
        found = work_map_store.add_capture(work_map_id, withdrawn)
    except Exception as e:
        raise _store_unavailable(e) from e
    if not found:
        raise HTTPException(status_code=404, detail="Work Map not found")
    return {"withdrawn": question_id, "questions": follow_ups.pending([*captures, withdrawn])}
