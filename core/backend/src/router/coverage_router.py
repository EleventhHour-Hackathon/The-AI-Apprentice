from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.router.path_router import _store_unavailable, _uuid
from src.services import coverage, privacy
from storage import work_maps as work_map_store

router = APIRouter(prefix="/api/v1", tags=["Coverage"])


class CoverageIn(BaseModel):
    event: str = Field(..., min_length=1, max_length=500)
    work_map_ids: Optional[List[str]] = Field(None, max_length=50)


@router.post("/coverage/check")
def check_coverage(body: CoverageIn) -> Dict[str, Any]:
    """Whether a confirmed Work Map already covers a screen event, or the question to ask.

    One get() per confirmed map per call: fine for a demo; a cached index comes with B-11.
    """
    event = privacy.redact(body.event.strip())
    if not event:
        raise HTTPException(status_code=422, detail="An event needs its text")
    wanted = None
    if body.work_map_ids is not None:
        wanted = {_uuid(i, "Work Map") for i in body.work_map_ids}
    try:
        summaries = work_map_store.list_summaries()
        ids = [
            str(s["id"])
            for s in summaries
            if s.get("status") == "confirmed" and (wanted is None or str(s["id"]) in wanted)
        ]
        maps = [m for m in (work_map_store.get(i) for i in ids) if m is not None]
    except Exception as e:
        raise _store_unavailable(e) from e
    return {**coverage.check(event, maps), "maps_checked": len(maps)}
