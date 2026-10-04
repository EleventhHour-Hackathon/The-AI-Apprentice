"""The living update: what a repeat session would change on the Work Map it was recorded again from.

When an expert records a confirmed map again, the final merge computes work_map_update.update
(parent, new) and keeps the result on the session as a LIVING_UPDATE capture: the updated steps
and rules, what changed, and a fingerprint of the parent it was computed from. Nothing touches the
parent then. Applying it is a person's explicit step (POST /work_maps/{id}/apply_update), and the
fingerprint refuses an update made against a parent that has changed since, including one that
was already applied.

Items the repeat session brought ("source": "new") keep their "at" and quotes, but those point
into the repeat session's recording, not the parent's. Applied, they carry "from_session" so the
parent's screen moments and clips are never attached to them.

Pure: no I/O, and no input is changed.
"""

import copy
from datetime import datetime
import hashlib
import json
from typing import Any, Dict, List, Optional

from src.services.follow_ups import LIVING_UPDATE


def fingerprint(work_map: Dict[str, Any]) -> str:
    """A hash of the map's steps and rules: it changes whenever either does."""
    body = {
        "steps": work_map.get("steps") or [],
        "guardrails": work_map.get("guardrails") or [],
    }
    text = json.dumps(body, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def capture(
    parent_id: str, parent: Dict[str, Any], result: Dict[str, Any], now: datetime
) -> Dict[str, Any]:
    """The LIVING_UPDATE capture for an update(parent, new) result, without the transcript."""
    updated = result["map"]
    return {
        "kind": LIVING_UPDATE,
        "parent_work_map_id": parent_id,
        "parent_fingerprint": fingerprint(parent),
        "changes": copy.deepcopy(result["changes"]),
        "map": {
            "task": copy.deepcopy(updated.get("task")),
            "steps": copy.deepcopy(updated.get("steps") or []),
            "guardrails": copy.deepcopy(updated.get("guardrails") or []),
        },
        "at": now.isoformat(timespec="seconds"),
    }


def latest(captures: List[Any], parent_id: str) -> Optional[Dict[str, Any]]:
    """The newest LIVING_UPDATE capture for that parent, or None."""
    found = None
    for c in captures or []:
        if (
            isinstance(c, dict)
            and c.get("kind") == LIVING_UPDATE
            and c.get("parent_work_map_id") == parent_id
            and isinstance(c.get("map"), dict)
        ):
            found = c
    return found


def applied(parent: Dict[str, Any], stored: Dict[str, Any], session_id: str) -> Dict[str, Any]:
    """The parent row with the stored update's steps and rules; the rest stays the parent's."""
    out = copy.deepcopy(parent)
    for section in ("steps", "guardrails"):
        items = copy.deepcopy(stored["map"].get(section) or [])
        for item in items:
            if isinstance(item, dict) and item.get("source") == "new":
                item["from_session"] = session_id
        out[section] = items
    task = out.get("task")
    if task is None or (isinstance(task, str) and not task.strip()):
        out["task"] = copy.deepcopy(stored["map"].get("task"))
    return out
