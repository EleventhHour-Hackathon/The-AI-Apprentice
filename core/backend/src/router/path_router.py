import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse

from src.services import apprentice_agent, recordings, tutor
from src.services.screen_vision import get_backend as get_vision_backend, log_frame
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
        found = work_map_store.add_capture(_uuid(session_id), payload)
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e)
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@router.post("/sessions/{session_id}/merge")
async def merge_session(session_id: str, payload: dict = Body(...)):
    """Merge the session into a Work Map: the draft for the debrief, or the final confirmed map.

    Body: {"transcript": [{"role": "expert"|"apprentice", "text", "t", "phase"}],
           "final": bool, "duration": seconds}
    """
    session_id = _uuid(session_id)
    final = bool(payload.get("final"))
    transcript: List[Dict[str, Any]] = [
        line
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
            captures=session.get("captures") or [],
            final=final,
        )
    except Exception as e:
        logger.error(f"Work Map merge failed: {e}")
        raise HTTPException(status_code=502, detail="Couldn't merge the Work Map")

    work_map.update(
        task=session.get("task"),
        transcript=transcript,
        duration=payload.get("duration"),
        corrections=[c["correction"] for c in session.get("captures") or [] if c.get("kind") == "correction"],
    )
    try:
        work_map_store.save_map(session_id, work_map, "confirmed" if final else "draft")
    except Exception as e:
        raise _store_unavailable(e)
    return {**work_map, "brief": brief_for_agent(work_map)}


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

    work_map.pop("captures", None)
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
    for item in [*(work_map.get("steps") or []), *(work_map.get("guardrails") or [])]:
        if not isinstance(item, dict):
            continue
        moment = by_time.get(item.get("at"))
        if moment:
            item["thumb"] = moment.get("thumb")
            item["event"] = moment.get("event")
        if recordings.covering(segments, item.get("at")):
            item["clip"] = f"/api/v1/sessions/{session_id}/clip?at={item['at']:.2f}"
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
async def get_clip(session_id: str, at: float):
    """A few seconds of the screen recording around a moment, as mp4: a short-lived Storage link."""
    session_id = _uuid(session_id)
    try:
        kind, where = await recordings.clip(session_id, at)
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
    event = str(payload.get("event") or "").strip()
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
        found = lesson_store.add_attempt(_uuid(lesson_id, "Lesson"), payload)
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
        lesson_store.finish(lesson_id, payload.get("transcript") or [], result)
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
