"""Update an expert's Work Map from a repeat session of the same task: one living map.

The earlier map is the parent; the repeat session's map is new. work_map_diff.diff(parent, new)
says which items are the same, which differ and which only one session has, and this turns that
into the updated map. Pure: no I/O, no LLM, and neither input is changed.

- Items come in the new session's order. An item that is the same keeps the parent's version
  untouched (its id, moment, quotes). An item that differs takes the new version under the
  parent's id and lists the fields that changed. An item only the new session has is added
  under a fresh id, numbered above every id the parent uses, so ids never collide.
- An item only the parent has is not deleted: it goes after the others, flagged "removed",
  until the expert says it no longer holds.
- Every item says where it came from: "source" is "parent" or "new", and that is the recording
  its "at" (the moment on screen) and its quotes refer to.
- A rule's "step" points at a step id of the updated map; one that doesn't resolve becomes "".
- The debrief asks only about what changed: new, changed and removed items, at most MAX_GAPS,
  steps before rules. Each question is a fixed English template, one per item; a changed item
  is asked about its most telling field. Nothing is asked about an unchanged item.
"""

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

from src.services.diff_questions import KINDS, number, trim
from src.services.work_map_diff import _ids, diff
from src.services.work_map_links import _label

MAX_GAPS = 8
SECTIONS = (("steps", "s"), ("guardrails", "g"))
# Flags an earlier update may have left on the parent's items.
FLAGS = ("source", "changed", "added", "removed")
# Which changed field a question is about, most telling first. A step's "guardrails" field is
# left out: the rule's own question covers it.
FIELD_ORDER = {
    "steps": ("decision", "judgment", "reason"),
    "guardrails": ("rule", "numbers", "applies_when", "kind", "ask_whom", "step"),
}
FALLBACK = {"steps": "this step", "guardrails": "this rule"}

ADDED = {
    "steps": "This time you {label}. What made you add that?",
    "guardrails": "This time you said {label}. When does that apply?",
}
REMOVED = {
    "steps": "Last time you {label}. Do you still do that?",
    "guardrails": "Last time you said {label}. Does that still apply?",
}
DECISION_CHANGED = "Last time you {old}; now you {new}. What changed?"
RULE_CHANGED = "Last time you said {old}; now you say {new}. What changed?"
KIND_CHANGED = "Last time {label} was {old}; now it's {new}. What changed?"
STEP_CHANGED = "Last time {label} came up at {old}; now at {new}. What changed?"
JUDGMENT_ON = "Last time {label} was routine; now it's a judgment call. What changed?"
JUDGMENT_OFF = "Last time {label} was a judgment call; now it's routine. What changed?"
# For the other fields: (both sessions said something, only the new one did, only the parent did).
FIELD_TEMPLATES: Dict[str, Tuple[str, str, str]] = {
    "numbers": (
        "Last time the number in {label} was {old}; now it's {new}. What changed?",
        "This time {label} has the number {new}. What changed?",
        "Last time {label} had the number {old}. Does that still hold?",
    ),
    "reason": (
        "Last time your reason for {label} was {old}; now it's {new}. What changed?",
        "This time your reason for {label} was {new}. What changed?",
        "Last time your reason for {label} was {old}. Does that still hold?",
    ),
    "applies_when": (
        "Last time {label} applied when {old}; now when {new}. What changed?",
        "This time {label} applies when {new}. What changed?",
        "Last time {label} applied when {old}. Does that still hold?",
    ),
    "ask_whom": (
        "Last time you asked {old} about {label}; now {new}. What changed?",
        "This time you ask {new} about {label}. What changed?",
        "Last time you asked {old} about {label}. Do you still?",
    ),
}


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _q(text: Any) -> str:
    """A text quoted for a question, trimmed to one line."""
    return _label(trim(text))


def _item_label(section: str, item: Optional[Dict[str, Any]]) -> str:
    """Rule text for a rule; decision, else title, for a step."""
    item = item or {}
    if section == "guardrails":
        return _q(item.get("rule"))
    return _label(trim(item.get("decision")), trim(item.get("title")))


def _numbers(values: Any) -> str:
    if isinstance(values, (list, tuple)):
        return " and ".join(number(v) for v in values)
    return number(values)


def _question(
    section: str,
    status: str,
    old: Optional[Dict[str, Any]] = None,
    new: Optional[Dict[str, Any]] = None,
    field: Optional[Dict[str, Any]] = None,
    step_titles: Tuple[str, str] = ("", ""),
) -> str:
    """One debrief question about an item that is "added", "removed" or "changed".

    old and new are the parent's and the new session's versions of the item; field is the
    diff's entry for the changed field ({"field", "kind", "a", "b"}). step_titles are the titles
    of the steps a changed rule's "step" field points at, in the parent and in the new session.
    """
    fallback = FALLBACK[section]
    # "This time you did this step", but "This time you said this rule".
    verb_fallback = "did this step" if section == "steps" else fallback
    if status == "added":
        return ADDED[section].format(label=_item_label(section, new) or verb_fallback)
    if status == "removed":
        return REMOVED[section].format(label=_item_label(section, old) or verb_fallback)
    label = _item_label(section, new) or _item_label(section, old) or fallback
    name = (field or {}).get("field")
    a, b = (field or {}).get("a"), (field or {}).get("b")
    if name == "decision":
        old_label = _item_label(section, old) or "did it another way"
        new_label = _item_label(section, new) or "do it another way"
        return DECISION_CHANGED.format(old=old_label, new=new_label)
    if name == "rule":
        return RULE_CHANGED.format(old=_q(a) or fallback, new=_q(b) or fallback)
    if name == "judgment":
        return (JUDGMENT_ON if b else JUDGMENT_OFF).format(label=label)
    if name == "kind":
        old_kind = KINDS.get(str(a), "a different kind of rule")
        new_kind = KINDS.get(str(b), "a different kind of rule")
        return KIND_CHANGED.format(label=label, old=old_kind, new=new_kind)
    if name == "step":
        old_step = _q(step_titles[0]) or "another step"
        new_step = _q(step_titles[1]) or "another step"
        return STEP_CHANGED.format(label=label, old=old_step, new=new_step)
    both, only_new, only_old = FIELD_TEMPLATES[str(name)]
    say = _numbers if name == "numbers" else _q
    old_text = "" if _blank(a) or a == [] else say(a)
    new_text = "" if _blank(b) or b == [] else say(b)
    if old_text and new_text:
        return both.format(label=label, old=old_text, new=new_text)
    if new_text:
        return only_new.format(label=label, new=new_text)
    return only_old.format(label=label, old=old_text)


def _clean(item: Dict[str, Any], item_id: str, source: str) -> Dict[str, Any]:
    out = copy.deepcopy(item)
    for flag in FLAGS:
        out.pop(flag, None)
    out["id"] = item_id
    out["source"] = source
    return out


def _fresh_ids(taken: List[str], prefix: str):
    """s<n> (or g<n>) with n above every numeric suffix in taken, counting up."""
    suffixes = [int(m.group(1)) for t in taken if (m := re.search(r"(\d+)$", t))]
    n = max(suffixes, default=0)
    used = set(taken)
    while True:
        n += 1
        if f"{prefix}{n}" not in used:
            yield f"{prefix}{n}"


def _title(section: str, item: Dict[str, Any]) -> str:
    if section == "guardrails":
        return str(item.get("rule") or "")
    return str(item.get("title") or item.get("step") or "")


def _step_titles(work_map: Dict[str, Any]) -> Dict[str, str]:
    steps = list(work_map.get("steps") or [])
    return {sid: _title("steps", s) for sid, s in zip(_ids(steps, "s"), steps, strict=True)}


def _key(text: Any) -> str:
    return " ".join(str(text or "").split()).casefold()


def update(parent: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, Any]:
    """The parent map updated from a repeat session's map, what changed, and what to ask.

    Returns {"map": the updated map, "changes": {"new", "changed", "removed", "unchanged"},
    "gaps": debrief questions about what changed only}.
    """
    d = diff(parent, new)
    out_map = copy.deepcopy(new)
    if _blank(out_map.get("task")):
        out_map["task"] = copy.deepcopy(parent.get("task"))

    built: Dict[str, List[Dict[str, Any]]] = {}
    # Per section, for each output item: (status, parent version, new version, changed fields).
    info: Dict[str, List[Tuple[str, Any, Any, List[Dict[str, Any]]]]] = {}
    # A new-session step id -> its id in the updated map.
    new_step_to_out: Dict[str, str] = {}
    for section, prefix in SECTIONS:
        items_a = list(parent.get(section) or [])
        items_b = list(new.get(section) or [])
        ids_a, ids_b = _ids(items_a, prefix), _ids(items_b, prefix)
        by_a = dict(zip(ids_a, items_a, strict=True))
        same = {e["b"]: e["a"] for e in d[section]["same"]}
        differs = {e["b"]: e for e in d[section]["differs"]}
        fresh = _fresh_ids(ids_a, prefix)
        items: List[Dict[str, Any]] = []
        notes: List[Tuple[str, Any, Any, List[Dict[str, Any]]]] = []
        for id_b, item_b in zip(ids_b, items_b, strict=True):
            if id_b in same:
                id_a = same[id_b]
                items.append(_clean(by_a[id_a], id_a, "parent"))
                notes.append(("unchanged", by_a[id_a], item_b, []))
            elif id_b in differs:
                entry = differs[id_b]
                id_a = entry["a"]
                item = _clean(item_b, id_a, "new")
                item["changed"] = [f["field"] for f in entry["fields"]]
                items.append(item)
                notes.append(("changed", by_a[id_a], item_b, entry["fields"]))
            else:
                id_a = next(fresh)
                item = _clean(item_b, id_a, "new")
                item["added"] = True
                items.append(item)
                notes.append(("new", None, item_b, []))
            if section == "steps":
                new_step_to_out[id_b] = id_a
        for entry in d[section]["only_a"]:
            item = _clean(by_a[entry["id"]], entry["id"], "parent")
            item["removed"] = True
            items.append(item)
            notes.append(("removed", by_a[entry["id"]], None, []))
        built[section] = items
        info[section] = notes

    # Point every rule at a step of the updated map.
    step_ids = {s["id"] for s in built["steps"]}
    for guard in built["guardrails"]:
        step = str(guard.get("step") or "")
        if guard["source"] == "new":
            step = new_step_to_out.get(step, "")
        guard["step"] = step if step in step_ids else ""

    changes: Dict[str, List[Dict[str, Any]]] = {
        "new": [],
        "changed": [],
        "removed": [],
        "unchanged": [],
    }
    gaps: List[str] = []
    step_titles_a = _step_titles(parent)
    step_titles_b = _step_titles(new)
    for section, _ in SECTIONS:
        for item, (status, old, newer, fields) in zip(built[section], info[section], strict=True):
            entry = {"section": section, "id": item["id"], "title": _title(section, item)}
            if status == "changed":
                entry["fields"] = list(item["changed"])
            changes[status].append(entry)
            if status in ("new", "removed"):
                gaps.append(_question(section, "added" if status == "new" else status, old, newer))
            elif status == "changed":
                by_name = {f["field"]: f for f in fields}
                name = next((n for n in FIELD_ORDER[section] if n in by_name), None)
                if name is None:
                    continue
                field = by_name[name]
                # Each side's step is named by its own map's title.
                titles = (
                    step_titles_a.get(str(field["a"] or ""), ""),
                    step_titles_b.get(str(field["b"] or ""), ""),
                )
                gaps.append(_question(section, "changed", old, newer, field, titles))
    gaps = gaps[:MAX_GAPS]

    seen, questions = set(), []
    for q in gaps + list(new.get("open_questions") or []):
        k = _key(q)
        if k and k not in seen:
            seen.add(k)
            questions.append(str(q).strip())
    out_map["steps"] = built["steps"]
    out_map["guardrails"] = built["guardrails"]
    out_map["open_questions"] = questions
    return {"map": out_map, "changes": changes, "gaps": gaps}
