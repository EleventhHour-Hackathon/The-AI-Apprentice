from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from src.router.path_router import _store_unavailable, _uuid
from src.services import work_map_diff
from storage import work_maps as work_map_store

router = APIRouter(prefix="/api/v1", tags=["Work Map diff"])


def _header(work_map: Dict[str, Any], work_map_id: str) -> Dict[str, Any]:
    """What the UI shows above each side: no transcript, captures or full map."""
    steps = work_map.get("steps")
    guardrails = work_map.get("guardrails")
    return {
        "id": work_map_id,
        "task": work_map.get("task"),
        "recorded_at": work_map.get("recorded_at"),
        "confirmed": bool(work_map.get("confirmed")),
        "status": work_map.get("status") or "",
        "steps": len(steps) if isinstance(steps, list) else 0,
        "guardrails": len(guardrails) if isinstance(guardrails, list) else 0,
    }


@router.get("/work_map_diff")
def get_work_map_diff(a: str, b: str) -> Dict[str, Any]:
    """How two Work Maps of the same task differ, step by step and rule by rule."""
    a = _uuid(a, "Work Map")
    b = _uuid(b, "Work Map")
    if a == b:
        raise HTTPException(status_code=422, detail="Pick two different Work Maps")
    maps: Dict[str, Dict[str, Any]] = {}
    try:
        for side, work_map_id in (("a", a), ("b", b)):
            work_map = work_map_store.get(work_map_id)
            if work_map is None:
                raise HTTPException(status_code=404, detail=f"Work Map {side} not found")
            maps[side] = {**work_map, "id": work_map_id}
    except HTTPException:
        raise
    except Exception as e:
        raise _store_unavailable(e) from e
    return {
        "a": _header(maps["a"], a),
        "b": _header(maps["b"], b),
        "diff": work_map_diff.diff(maps["a"], maps["b"]),
    }
