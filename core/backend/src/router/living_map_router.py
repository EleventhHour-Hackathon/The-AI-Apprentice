from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from src.router.path_router import _store_unavailable, _uuid
from src.services import follow_ups, living_map
from storage import work_maps as work_map_store

router = APIRouter(prefix="/api/v1", tags=["Living map"])


@router.post("/work_maps/{work_map_id}/apply_update")
def apply_update(work_map_id: str, session: str = Query(..., alias="from")):
    """Apply the update a repeat session kept for this Work Map: its steps and rules, same ids.

    Only the update made against the map as it is now applies; applying it changes the map, so
    a second apply of the same update is refused (409).
    """
    parent_id = _uuid(work_map_id, "Work Map")
    session_id = _uuid(session)
    try:
        parent = work_map_store.get(parent_id)
        if parent is None:
            raise HTTPException(status_code=404, detail="Work Map not found")
        repeat = work_map_store.get(session_id)
        if repeat is None:
            raise HTTPException(status_code=404, detail="Session not found")
        stored = living_map.latest(repeat.get("captures") or [], parent_id)
        if stored is None:
            raise HTTPException(
                status_code=422, detail="This session has no update for that Work Map"
            )
        if living_map.fingerprint(parent) != stored.get("parent_fingerprint"):
            raise HTTPException(
                status_code=409,
                detail=(
                    "The Work Map changed since this update was made. Record it again to update it."
                ),
            )
        work_map_store.save_map(
            parent_id, living_map.applied(parent, stored, session_id), "confirmed"
        )
        work_map_store.add_capture(
            parent_id,
            {
                "kind": follow_ups.LIVING_APPLIED,
                "from_session": session_id,
                "changes": stored["changes"],
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e) from e
    return {"work_map_id": parent_id, "applied_from": session_id, "changes": stored["changes"]}
