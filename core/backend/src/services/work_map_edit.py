"""Changes the expert asks for by voice once a Work Map is saved.

From the debrief on, the apprentice can change, remove or add a step or a
guardrail ("change the first rule", "actually it's ten thousand", "drop step
three"). Edits are applied to the saved map directly, so they show at once,
and also kept as corrections, so the final merge after the teach-back keeps
them instead of rebuilding the old version from the transcript.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

STEP_FIELDS = ("title", "decision", "reason")
RULE_FIELDS = ("rule", "kind", "applies_when", "ask_whom")
KINDS = ("limit", "exception", "stop_and_ask")


class EditError(Exception):
    pass


def _normalize(work_map: Dict[str, Any]) -> Dict[str, Any]:
    """Maps saved before ids existed (imported JSON) get s1.. / g1.. and a step title.

    An id-less item gets its position (s3) unless another item already has that id; then it
    gets the next number above every id taken, so ids stay unique. Existing ids never change.
    """
    for prefix, key in (("s", "steps"), ("g", "guardrails")):
        items = work_map.get(key) or []
        taken = {str(item["id"]) for item in items if item.get("id")}
        for n, item in enumerate(items, 1):
            item.setdefault("id", None)
            if not item["id"]:
                new_id = f"{prefix}{n}"
                if new_id in taken:
                    numbers = [int(t[1:]) for t in taken if t[1:].isdigit()]
                    new_id = f"{prefix}{max(numbers, default=0) + 1}"
                item["id"] = new_id
                taken.add(new_id)
            if key == "steps" and not item.get("title"):
                item["title"] = item.get("step") or ""
    return work_map


def summary_for_agent(work_map: Dict[str, Any]) -> str:
    """The saved map as the agent reads it back, with the id to use for each item."""
    _normalize(work_map)
    lines = ["STEPS"]
    for n, s in enumerate(work_map.get("steps") or [], 1):
        reason = re.sub(r"^because\s+", "", str(s.get("reason") or ""), flags=re.I)
        lines.append(
            f"Step {n} [id {s.get('id')}] title: {s.get('title')}"
            + (f" | decision: {s['decision']}" if s.get("decision") else "")
            + (f" | reason: {reason}" if reason else "")
        )
    if len(lines) == 1:
        lines.append("(none)")
    lines.append("RULES")
    guards = work_map.get("guardrails") or []
    for n, g in enumerate(guards, 1):
        when = re.sub(r"^(when|if)\s+", "", str(g.get("applies_when") or ""), flags=re.I)
        lines.append(
            f"Rule {n} [id {g.get('id')}] rule: {g.get('rule')} | kind: {g.get('kind') or 'limit'}"
            + (f" | applies_when: {when}" if when else "")
            + (f" | ask_whom: {g['ask_whom']}" if g.get("ask_whom") else "")
        )
    if not guards:
        lines.append("(none)")
    return "\n".join(lines)


def _numbers(text: str) -> set:
    return {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}


def _still_mentions(work_map: Dict[str, Any], edited: Dict[str, Any], before: str, after: str) -> str:
    """Other items that still carry a number this change replaced (5,000 -> 10,000 in a step's reason)."""
    gone = _numbers(before) - _numbers(after)
    if not gone:
        return ""
    hits = []
    for item in [*(work_map.get("steps") or []), *(work_map.get("guardrails") or [])]:
        if item is edited:
            continue
        for field in (*STEP_FIELDS, *RULE_FIELDS):
            text = str(item.get(field) or "")
            if _numbers(text) & gone:
                hits.append(f"{item.get('id')} {field} \"{text}\"")
    return ", ".join(hits)


def _find(items: List[Dict[str, Any]], item_id: str) -> Optional[int]:
    return next((i for i, it in enumerate(items) if it.get("id") == item_id), None)


def _next_id(items: List[Dict[str, Any]], prefix: str) -> str:
    numbers = [int(str(it.get("id"))[1:]) for it in items if str(it.get("id", ""))[1:].isdigit()]
    return f"{prefix}{max(numbers, default=0) + 1}"


def apply(work_map: Dict[str, Any], edit: Dict[str, Any]) -> Tuple[Dict[str, Any], str, str]:
    """Apply one edit. Returns the map, a sentence describing the change (kept as a correction),
    and the other items that still carry a value the change replaced ("" if none)."""
    _normalize(work_map)
    action = edit.get("action")
    item_id = str(edit.get("item_id") or "").strip()
    said = str(edit.get("said") or "").strip()
    kind = "step" if item_id.startswith("s") or edit.get("what") == "step" else "rule"
    items: List[Dict[str, Any]] = work_map.setdefault("steps" if kind == "step" else "guardrails", [])
    fields = STEP_FIELDS if kind == "step" else RULE_FIELDS
    values = {f: str(edit[f]).strip() for f in fields if isinstance(edit.get(f), str) and edit[f].strip()}
    if "reason" in values:  # the summary says "because" itself
        values["reason"] = re.sub(r"^because\s+", "", values["reason"], flags=re.I)
    if "kind" in values and values["kind"] not in KINDS:
        values.pop("kind")

    if action == "add":
        if not values.get("title" if kind == "step" else "rule"):
            raise EditError(f"A new {kind} needs its {'title' if kind == 'step' else 'rule'}")
        new = {
            "id": _next_id(items, "s" if kind == "step" else "g"),
            **{f: "" for f in fields},
            "at": None, "quote": said, "quote_source": "debrief" if said else "none",
            **({"screen": "", "judgment": bool(values.get("decision"))} if kind == "step" else {"kind": "limit", "step": ""}),
            **values,
        }
        position = edit.get("after_id")
        index = _find(items, str(position)) if position else None
        items.insert(len(items) if index is None else index + 1, new)
        return work_map, f"Added {kind} {new['id']}: {new.get('title') or new.get('rule')}", ""

    index = _find(items, item_id)
    if index is None:
        raise EditError(f"There is no {kind} with id {item_id or '(none)'}")
    item = items[index]
    label = item.get("title") or item.get("rule")

    if action == "remove":
        items.pop(index)
        if kind == "step":  # rules that hung off the step stay, just not attached to it
            for g in work_map.get("guardrails") or []:
                if g.get("step") == item_id:
                    g["step"] = ""
        return work_map, f"Removed {kind} {item_id}: {label}", ""

    if action == "change":
        if not values:
            raise EditError("Nothing to change: pass the new wording for at least one field")
        before = " ".join(str(item.get(f) or "") for f in fields)
        item.update(values)
        stale = _still_mentions(work_map, item, before, " ".join(str(item.get(f) or "") for f in fields))
        if said:
            item["quote"], item["quote_source"] = said, "debrief"
        changed = ", ".join(f"{f} is now '{v}'" for f, v in values.items())
        return work_map, f"Changed {kind} {item_id} ({label}): {changed}", stale

    raise EditError("action must be change, remove or add")
