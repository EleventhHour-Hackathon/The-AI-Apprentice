import math
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse

from src.services import apprentice_agent, recordings, tutor
from src.services.screen_vision import get_backend as get_vision_backend, log_frame
from src.services import live_questions, work_map_edit, work_map_links
from src.services.privacy import redact, redact_deep
from src.services.work_map_merge import brief_for_agent, merge
from src.utils.logger import logger
from storage import lessons as lesson_store
from storage import media as media_store
from storage import work_maps as work_map_store

router = APIRouter(
    prefix="/api/v1",
    tags=["Path"],
    responses={404: {"description": "Not found"}},
)


def _uuid(value: str, what: str = "Session") -> str:
    # Session and Work Map ids are UUIDs; reject anything else before it reaches the database.
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found")


def _store_unavailable(e: Exception) -> HTTPException:
    logger.error(f"Work Map store failed: {e}")
    return HTTPException(status_code=503, detail="Work Map storage is unavailable")


# Plain `def` where psycopg or urllib block: FastAPI runs those in its threadpool.


@router.get("/agent/token")
def agent_token(role: str = "apprentice"):
    """A WebRTC token for one conversation with an agent on ElevenLabs: the apprentice or the tutor."""
    if role not in apprentice_agent.ROLES:
        raise HTTPException(status_code=404, detail="No such agent")
    try:
        return apprentice_agent.conversation_token(role)
    except apprentice_agent.ElevenLabsError as e:
        logger.error(f"Couldn't get an ElevenLabs conversation token: {e}")
        raise HTTPException(status_code=502, detail="Couldn't reach the ElevenLabs agent")


@router.post("/screen_event")
async def screen_event(payload: dict = Body(...)):
    """Describe what changed on the expert's screen since the last frame.

    The pill samples its screen share every couple of seconds and posts the
    frame here; we hand back an event it can drop into the live conversation
    so the agent knows what the expert is doing. With a session_id, changes
    are also kept with their time and a thumbnail as screen moments.
    """
    frame = payload.get("frame")
    if not frame:
        raise HTTPException(status_code=400, detail="Missing 'frame'")

    # Accept either a bare base64 payload or a full data: URL.
    if frame.startswith("data:"):
        frame = frame.split(",", 1)[-1]

    backend = get_vision_backend()
    try:
        result = await backend.describe(frame, payload.get("previous"))
    except Exception as e:
        logger.error(f"Screen understanding failed: {e}")
        raise HTTPException(status_code=502, detail="Screen understanding failed")

    # The shield already hid personal data in the frame; this catches anything the model still wrote.
    result = {**result, "event": redact(result["event"]) if result.get("event") else result.get("event"),
              "description": redact(result.get("description") or "")}
    log_frame(frame, result, type(backend).__name__)

    session_id = payload.get("session_id")
    if session_id and result["changed"]:
        try:
            work_map_store.add_screen_event(
                _uuid(session_id),
                {
                    "t": float(payload.get("t") or 0),
                    "event": result["event"],
                    "description": result["description"],
                    "kind": result.get("kind"),
                    "thumb": payload.get("thumb"),
                },
            )
        except HTTPException:
            raise
        except Exception as e:
            # The live conversation matters more than the record of it.
            logger.error(f"Couldn't store screen event: {e}")
    return result


@router.post("/sessions/{session_id}/start")
def start_session(session_id: str, payload: dict = Body(default={})):
    try:
        work_map_store.start_session(_uuid(session_id), payload.get("conversation_id"))
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    return {"ok": True}


@router.delete("/sessions/{session_id}")
def discard_session(session_id: str):
    """Drop a session that ended with nothing to save: its row, screen moments and recording.

    Only sessions still 'recording' (never merged into a Work Map) can be discarded this way.
    """
    session_id = _uuid(session_id)
    try:
        session = work_map_store.get(session_id)
        if session is None:
            return {"deleted": None}
        if session.get("status") != "recording":
            raise HTTPException(status_code=409, detail="This session already has a Work Map")
        recordings.delete(session_id)
        work_map_store.delete(session_id)
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    return {"deleted": session_id}


@router.post("/sessions/{session_id}/task")
def set_task(session_id: str, payload: dict = Body(...)):
    try:
        work_map_store.set_task(_uuid(session_id), str(payload.get("task") or "").strip()[:200])
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    return {"ok": True}


@router.post("/sessions/{session_id}/capture")
def add_capture(session_id: str, payload: dict = Body(...)):
    """Something the agent recorded live through a client tool (record_step, record_guardrail, ...)."""
    try:
        found = work_map_store.add_capture(_uuid(session_id), redact_deep(payload))
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@router.post("/sessions/{session_id}/live_question")
async def add_live_question(session_id: str, payload: dict = Body(...)):
    """A question the apprentice asked at a pause while the expert worked.

    Body: {"text", "t"}. Returns {"kind": "guardrail"|"reason"|"other"}, so the pill knows
    whether the guardrail question has been asked yet.
    """
    session_id = _uuid(session_id)
    text = redact(str(payload.get("text") or "").strip())
    t = payload.get("t")
    if not text or not isinstance(t, (int, float)):
        raise HTTPException(status_code=422, detail="A live question needs its text and time")
    kind = await live_questions.classify(text)
    capture = {"kind": "live_question", "text": text, "t": round(float(t), 2), "question_kind": kind, "phase": "live"}
    try:
        found = await run_in_threadpool(work_map_store.add_capture, session_id, capture)
    except Exception as e:
        raise _store_unavailable(e)
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"kind": kind}


@router.post("/sessions/{session_id}/live_question/defer")
def defer_live_question(session_id: str, payload: dict = Body(...)):
    """The expert put a live question off for the debrief ("Later"): it no longer counts as asked."""
    t = payload.get("t")
    if not isinstance(t, (int, float)):
        raise HTTPException(status_code=422, detail="Which question: give its time t")
    try:
        found = work_map_store.defer_live_question(_uuid(session_id), round(float(t), 2))
    except Exception as e:
        raise _store_unavailable(e)
    return {"deferred": found}


@router.post("/sessions/{session_id}/merge")
async def merge_session(session_id: str, payload: dict = Body(...)):
    """Merge the session into a Work Map: the draft for the debrief, or the final confirmed map.

    Body: {"transcript": [{"role": "expert"|"apprentice", "text", "t", "phase"}],
           "final": bool, "duration": seconds,
           "confirmation": {"teach_back", "said", "t"}}
    confirmation (final only): the teach-back and the expert's words confirming it.
    """
    session_id = _uuid(session_id)
    final = bool(payload.get("final"))
    transcript: List[Dict[str, Any]] = [
        {**line, "text": redact(line["text"])}
        for line in payload.get("transcript") or []
        if isinstance(line, dict) and line.get("role") in ("expert", "apprentice") and line.get("text")
    ]
    try:
        session = work_map_store.get(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        events = work_map_store.screen_events(session_id)
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)

    try:
        work_map = await merge(
            task=session.get("task"),
            events=events,
            transcript=transcript,
            # Live questions are the apprentice's, not what it learned; the transcript has them.
            captures=[c for c in session.get("captures") or [] if c.get("kind") != "live_question"],
            final=final,
        )
    except Exception as e:
        logger.error(f"Work Map merge failed: {e}")
        raise HTTPException(status_code=502, detail="Couldn't merge the Work Map")

    work_map.update(
        # The merge names the task in English, the Work Map's language; else the expert's words.
        task=(work_map.get("task") or "").strip() or session.get("task"),
        transcript=transcript,
        duration=payload.get("duration"),
        corrections=[c["correction"] for c in session.get("captures") or [] if c.get("kind") == "correction"],
    )
    confirmation = payload.get("confirmation")
    if (
        final
        and isinstance(confirmation, dict)
        and isinstance(confirmation.get("teach_back"), str)
        and isinstance(confirmation.get("said"), str)
        and isinstance(confirmation.get("t"), (int, float))
        and not isinstance(confirmation.get("t"), bool)
        # JSON allows Infinity and NaN; jsonb doesn't.
        and math.isfinite(confirmation["t"])
        and confirmation["t"] >= 0
    ):
        # The teach-back the expert confirmed, and their words confirming it.
        work_map["confirmation"] = {
            "teach_back": redact(confirmation["teach_back"]),
            "said": redact(confirmation["said"]),
            "t": round(float(confirmation["t"]), 2),
        }
    try:
        work_map_store.save_map(session_id, work_map, "confirmed" if final else "draft")
    except Exception as e:
        raise _store_unavailable(e)
    return {**work_map, "brief": brief_for_agent(work_map), "summary": work_map_edit.summary_for_agent(work_map)}


def _saved_map(session_id: str) -> Dict[str, Any]:
    session = work_map_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.get("status") == "recording":
        raise HTTPException(status_code=409, detail="No Work Map saved yet: it is saved when the debrief starts")
    return session


@router.get("/sessions/{session_id}/summary")
def work_map_summary(session_id: str):
    """The saved Work Map as the apprentice reads it back, with an id for every step and rule."""
    try:
        return {"summary": work_map_edit.summary_for_agent(_saved_map(_uuid(session_id)))}
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)


@router.post("/sessions/{session_id}/edit")
def edit_work_map(session_id: str, payload: dict = Body(...)):
    """Change, remove or add a step or rule because the expert asked to, by voice.

    Body: {"action": "change"|"remove"|"add", "item_id": "s2"|"g1", "what": "step"|"rule" (for add),
           "title"/"decision"/"reason" or "rule"/"kind"/"applies_when"/"ask_whom", "said", "after_id", "t"}
    The change is saved over the map and kept as a correction, so a later merge keeps it too.
    """
    payload = redact_deep(payload)
    session_id = _uuid(session_id)
    try:
        session = _saved_map(session_id)
        before = {id(i) for i in [*(session.get("steps") or []), *(session.get("guardrails") or [])]}
        try:
            work_map, change, stale = work_map_edit.apply(session, payload)
        except work_map_edit.EditError as e:
            raise HTTPException(status_code=422, detail=str(e))
        # Something added by voice borrows the screen moment of the step it is about.
        for item in [*(work_map.get("steps") or []), *(work_map.get("guardrails") or [])]:
            if id(item) not in before:
                work_map_links.link_added(work_map, item, str(payload.get("after_id") or ""))
        work_map["corrections"] = [*(work_map.get("corrections") or []), change]
        work_map_store.save_map(session_id, work_map, session["status"])
        work_map_store.add_capture(
            session_id,
            {"kind": "correction", "correction": change, "quote": payload.get("said") or "", "t": payload.get("t"), "phase": "debrief"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    logger.info(f"Work Map {session_id} edited: {change}")
    return {"change": change, "stale": stale, "summary": work_map_edit.summary_for_agent(work_map)}


@router.get("/work_maps")
def list_work_maps():
    """Every saved Work Map, newest first, without the transcript."""
    try:
        return work_map_store.list_summaries()
    except Exception as e:
        raise _store_unavailable(e)


@router.get("/work_maps/{work_map_id}")
def get_work_map(work_map_id: str):
    """One Work Map, with each step's and guardrail's screen moment (time, event, thumbnail)."""
    work_map_id = _uuid(work_map_id, "Work Map")
    try:
        work_map = work_map_store.get(work_map_id)
        if work_map is None:
            raise HTTPException(status_code=404, detail="Work Map not found")
        events = work_map_store.screen_events(work_map_id, with_thumbs=True)
        segments = media_store.recordings(work_map_id)
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)

    work_map["live_questions"] = live_questions.from_captures(work_map.pop("captures", None) or [])
    return _with_moments(work_map_id, work_map, events, segments)


def _with_moments(
    session_id: str,
    work_map: Dict[str, Any],
    events: List[Dict[str, Any]],
    segments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Attach each step's and guardrail's screen moment (event, thumbnail and, if recorded, a clip)."""
    # Merged times are snapped to screen events, so an exact match finds the moment.
    by_time = {e["t"]: e for e in events}
    windows = recordings.item_windows(work_map)
    for item in [*(work_map.get("steps") or []), *(work_map.get("guardrails") or [])]:
        if not isinstance(item, dict):
            continue
        moment = by_time.get(item.get("at"))
        if moment:
            item["thumb"] = moment.get("thumb")
            item["event"] = moment.get("event")
        window = windows.get(id(item))
        if window and recordings.covering(segments, item.get("at"), *window):
            begin, stop = window
            item["clip"] = (
                f"/api/v1/sessions/{session_id}/clip?at={item['at']:.2f}&start={begin:.2f}&end={stop:.2f}"
            )
    return work_map


@router.post("/sessions/{session_id}/recordings")
async def upload_recording(session_id: str, start: float, end: float, request: Request):
    """One segment of the screen recording (webm), from `start` to `end` on the session clock."""
    session_id = _uuid(session_id)
    data = await request.body()
    try:
        await run_in_threadpool(recordings.save_segment, session_id, start, end, data)
    except recordings.RecordingError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.get("/sessions/{session_id}/clip")
async def get_clip(session_id: str, at: float, start: Optional[float] = None, end: Optional[float] = None):
    """The screen recording of one subtask (start to end, around the moment at), as mp4:
    a short-lived Storage link. Without start and end, the few seconds leading up to at."""
    session_id = _uuid(session_id)
    if start is None or end is None:
        start, end = recordings.clip_window(at)
    try:
        kind, where = await recordings.clip(session_id, at, start, end)
    except (recordings.RecordingError, media_store.StorageError) as e:
        logger.warning(f"No clip at {at} for {session_id}: {e}")
        raise HTTPException(status_code=404, detail="No recording of this moment")
    if kind == "url":
        return RedirectResponse(where, status_code=302)
    return FileResponse(where, media_type="video/mp4", headers={"Cache-Control": "max-age=3600"})


@router.delete("/work_maps/{work_map_id}")
def delete_work_map(work_map_id: str):
    work_map_id = _uuid(work_map_id, "Work Map")
    try:
        # Video first: once the row is gone, nothing records where it was.
        recordings.delete(work_map_id)
        deleted = work_map_store.delete(work_map_id)
    except Exception as e:
        raise _store_unavailable(e)
    if not deleted:
        raise HTTPException(status_code=404, detail="Work Map not found")
    return {"deleted": work_map_id}


# Lessons: a new hire works a case while the tutor watches, taught from one Work Map.

_lesson_maps: Dict[str, Dict[str, Any]] = {}


def _lesson_map(lesson_id: str) -> Dict[str, Any]:
    """The Work Map a lesson teaches from; cached, since every screen event checks against it."""
    if lesson_id not in _lesson_maps:
        lesson = lesson_store.get(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Lesson not found")
        work_map = work_map_store.get(lesson["work_map_id"])
        if work_map is None:
            raise HTTPException(status_code=404, detail="Work Map not found")
        _lesson_maps[lesson_id] = work_map
    return _lesson_maps[lesson_id]


@router.post("/lessons")
def start_lesson(payload: dict = Body(...)):
    """Start teaching from a Work Map. Returns what the tutor and the pill need to teach it."""
    work_map_id = _uuid(payload.get("work_map_id"), "Work Map")
    lesson_id = str(uuid.uuid4())
    try:
        work_map = work_map_store.get(work_map_id)
        if work_map is None:
            raise HTTPException(status_code=404, detail="Work Map not found")
        if not work_map.get("steps"):
            raise HTTPException(status_code=422, detail="This Work Map has no steps to teach yet")
        events = work_map_store.screen_events(work_map_id, with_thumbs=True)
        segments = media_store.recordings(work_map_id)
        lesson_store.create(lesson_id, work_map_id)
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    _lesson_maps[lesson_id] = work_map
    with_moments = _with_moments(work_map_id, dict(work_map), events, segments)
    return {
        "lesson_id": lesson_id,
        "task": work_map.get("task") or "the task",
        "work_map": tutor.work_map_text(work_map),
        "steps": with_moments.get("steps") or [],
        "guardrails": with_moments.get("guardrails") or [],
    }


@router.post("/lessons/{lesson_id}/start")
def lesson_connected(lesson_id: str, payload: dict = Body(...)):
    try:
        lesson_store.set_conversation(_uuid(lesson_id, "Lesson"), str(payload.get("conversation_id") or ""))
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    return {"ok": True}


@router.post("/lessons/{lesson_id}/check")
async def check_lesson_event(lesson_id: str, payload: dict = Body(...)):
    """Judge the new hire's latest screen event against the Work Map: step in, ok, fixed or nothing.

    Body: {"event": str, "history": [{"t", "event"}], "open_flags": [{"step", "what_happened"}]}
    """
    lesson_id = _uuid(lesson_id, "Lesson")
    event = redact(str(payload.get("event") or "").strip())
    if not event:
        raise HTTPException(status_code=400, detail="Missing 'event'")
    try:
        work_map = _lesson_map(lesson_id)
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    try:
        return await tutor.check(
            work_map, payload.get("history") or [], event, payload.get("open_flags") or []
        )
    except Exception as e:
        logger.error(f"Tutor check failed: {e}")
        raise HTTPException(status_code=502, detail="Couldn't check the step")


@router.post("/lessons/{lesson_id}/attempt")
def add_lesson_attempt(lesson_id: str, payload: dict = Body(...)):
    """Something that counts towards mastery: a prediction, an intervention, a fix or a step done right."""
    try:
        found = lesson_store.add_attempt(_uuid(lesson_id, "Lesson"), redact_deep(payload))
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    if not found:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return {"ok": True}


@router.post("/lessons/{lesson_id}/finish")
def finish_lesson(lesson_id: str, payload: dict = Body(default={})):
    """What the new hire mastered and what to practice next."""
    lesson_id = _uuid(lesson_id, "Lesson")
    try:
        lesson = lesson_store.get(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Lesson not found")
        result = tutor.report(_lesson_map(lesson_id), lesson.get("attempts") or [])
        lesson_store.finish(lesson_id, redact_deep(payload.get("transcript") or []), result)
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    return result


@router.get("/lessons/{lesson_id}")
def get_lesson(lesson_id: str):
    try:
        lesson = lesson_store.get(_uuid(lesson_id, "Lesson"))
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson
