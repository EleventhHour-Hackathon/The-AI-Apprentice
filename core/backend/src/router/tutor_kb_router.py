from fastapi import APIRouter, HTTPException

from src.router.path_router import _store_unavailable, _uuid
from src.services import tutor_kb
from storage import work_maps as work_map_store

router = APIRouter(prefix="/api/v1", tags=["Tutor KB"])


@router.get("/work_maps/{work_map_id}/tutor_kb")
def get_tutor_kb(work_map_id: str):
    """The Work Map as a knowledge-base document and one Procedure per step, for the tutor."""
    work_map_id = _uuid(work_map_id, "Work Map")
    try:
        work_map = work_map_store.get(work_map_id)
        if work_map is None:
            raise HTTPException(status_code=404, detail="Work Map not found")
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e) from e
    steps = work_map.get("steps")
    if not isinstance(steps, list) or not any(isinstance(s, dict) for s in steps):
        raise HTTPException(status_code=422, detail="This Work Map has no steps to teach yet")
    return tutor_kb.payload({**work_map, "id": work_map_id})
