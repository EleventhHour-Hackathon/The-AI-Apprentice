"""A Work Map as ready-to-push payloads for the tutor agent on ElevenLabs.

- knowledge_base_document: the whole map as one Markdown document for the tutor's knowledge base.
- procedures: one Procedure per step, with the guardrails that belong to that step.
- payload: both, plus the guardrails that belong to no step.

Nothing here calls ElevenLabs or any other service; pushing the payloads is done by hand.
Ids default to s1.., g1.. by position like work_map_text, and a narration quote (said while doing
the step) is context, never the reason for it. A map with odd shapes (a string for a list, None
items) is read as far as it makes sense rather than failing.

These payloads leave the machine and quotes can name colleagues, so every free-text field (task,
titles, screen, decision, reason, quotes and their translations, rule, applies_when, ask_whom,
open questions) goes through privacy.redact first; ids and step references don't. Names are
redacted too once the Presidio extra is installed.
"""

from typing import Any, Dict, List, Tuple

from src.services.privacy import redact
from src.services.tutor import GUARD_KIND, _in_english, _step_title

STEP_TEXT = ("title", "step", "screen", "decision", "reason", "quote", "quote_translation")
GUARD_TEXT = ("rule", "applies_when", "ask_whom", "quote", "quote_translation")


def _redact_fields(item: Any, fields: Tuple[str, ...]) -> Any:
    if not isinstance(item, dict):
        return item  # kept so default ids still count positions
    return {**item, **{k: redact(item[k]) for k in fields if isinstance(item.get(k), str)}}


def _redacted(work_map: Dict[str, Any]) -> Dict[str, Any]:
    """A copy with personal data taken out of every free-text field."""
    clean = dict(work_map)
    if isinstance(clean.get("task"), str):
        clean["task"] = redact(clean["task"])
    for key, fields in (("steps", STEP_TEXT), ("guardrails", GUARD_TEXT)):
        if isinstance(clean.get(key), list):
            clean[key] = [_redact_fields(item, fields) for item in clean[key]]
    if isinstance(clean.get("open_questions"), list):
        clean["open_questions"] = [
            redact(q) if isinstance(q, str) else q for q in clean["open_questions"]
        ]
    return clean


def _items(work_map: Dict[str, Any], key: str) -> List[Tuple[int, Any]]:
    """(position, item) for each item of a list field; anything but a list counts as empty."""
    value = work_map.get(key)
    return list(enumerate(value, 1)) if isinstance(value, list) else []


def _quoted(item: Dict[str, Any]) -> str:
    return f'"{item["quote"]}"{_in_english(item)}' if item.get("quote") else ""


def _narration(step: Dict[str, Any]) -> bool:
    return step.get("quote_kind") == "narration"


def _why(step: Dict[str, Any]) -> str:
    """The reason for a step, or the expert's words explaining it. Never a narration quote."""
    if step.get("reason"):
        return step["reason"]
    if step.get("quote") and not _narration(step):
        return _quoted(step)
    return ""


def _expert_words(step: Dict[str, Any]) -> str:
    if not step.get("quote"):
        return ""
    return f"Said while doing it: {_quoted(step)}" if _narration(step) else _quoted(step)


def _steps(work_map: Dict[str, Any]) -> List[Tuple[str, bool, Dict[str, Any]]]:
    """(unique id, is the first step with its id, step) in order.

    Ids default to s{i} by position. A repeated id gets -2, -3, ... so each Procedure has its
    own, and only the first step with an id gets the guardrails that name it.
    """
    result, seen = [], set()
    for i, s in _items(work_map, "steps"):
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or f"s{i}")
        uid, n = sid, 1
        while uid in seen:
            n += 1
            uid = f"{sid}-{n}"
        seen.add(uid)
        result.append((uid, uid == sid, s))
    return result


def _guards(work_map: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    return [
        (str(g.get("id") or f"g{i}"), g)
        for i, g in _items(work_map, "guardrails")
        if isinstance(g, dict)
    ]


def _kind(guard: Dict[str, Any]) -> str:
    return GUARD_KIND.get(guard.get("kind", ""), "Rule")


def _guard_line(guard: Dict[str, Any]) -> str:
    line = f"{_kind(guard)}: {guard.get('rule') or ''}"
    return f"{line} (applies when {guard['applies_when']})" if guard.get("applies_when") else line


def _stop_line(guard: Dict[str, Any]) -> str:
    whom = guard.get("ask_whom") or "a person responsible"
    return f"Stop and ask {whom} when {guard.get('applies_when') or guard.get('rule') or ''}"


def _task(work_map: Dict[str, Any]) -> str:
    return (work_map.get("task") or "").strip() or "Untitled task"


def knowledge_base_document(work_map: Dict[str, Any]) -> Dict[str, str]:
    """The whole Work Map as one Markdown document: {"name", "text"}."""
    return _knowledge_base_document(_redacted(work_map))


def _knowledge_base_document(work_map: Dict[str, Any]) -> Dict[str, str]:
    task = _task(work_map)
    short_id = str(work_map.get("id") or "")[:8]
    name = f"Work Map: {task} ({short_id})" if short_id else f"Work Map: {task}"

    lines = [f"# {name}", ""]
    if work_map.get("status") != "confirmed":
        lines += ["Draft: not confirmed by the expert", ""]
    lines += [f"Task: {task}", "", "## Steps (in order)"]
    steps = _steps(work_map)
    for sid, _, s in steps:
        lines.append("")
        title = f"### {sid}. {_step_title(s)}"
        if s.get("judgment"):
            title += " (judgment call)"
        lines.append(title)
        if s.get("screen"):
            lines.append(f"- On screen: {s['screen']}")
        if s.get("decision"):
            lines.append(f"- Decision the expert made on their case: {s['decision']}")
        if s.get("reason"):
            lines.append(f"- Reason: {s['reason']}")
        if s.get("quote") and not _narration(s):
            lines.append(f"- Expert's words: {_quoted(s)}")
        if s.get("quote") and _narration(s):
            lines.append(f"- Said while doing it (not a reason): {_quoted(s)}")
    if not steps:
        lines.append("(none)")

    lines += ["", "## Guardrails"]
    guards = _guards(work_map)
    for gid, g in guards:
        lines.append("")
        lines.append(f"### {gid}. {_kind(g)}: {g.get('rule') or ''}")
        if g.get("step"):
            lines.append(f"- Step: {g['step']}")
        if g.get("applies_when"):
            lines.append(f"- Applies when: {g['applies_when']}")
        if g.get("ask_whom"):
            lines.append(f"- Ask: {g['ask_whom']}")
        if g.get("quote"):
            lines.append(f"- Expert's words: {_quoted(g)}")
    if not guards:
        lines.append("(none)")

    lines += ["", "## Open questions", ""]
    questions = [str(q) for _, q in _items(work_map, "open_questions") if q]
    lines += [f"- {q}" for q in questions] or ["(none)"]
    return {"name": name, "text": "\n".join(lines) + "\n"}


def _general(gid: str, g: Dict[str, Any]) -> Dict[str, str]:
    return {
        "id": gid,
        "kind": _kind(g),
        "rule": g.get("rule") or "",
        "applies_when": g.get("applies_when") or "",
        "ask_whom": g.get("ask_whom") or "",
        "expert_words": _quoted(g),
    }


def procedures(work_map: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One Procedure per step, in order, with only that step's guardrails."""
    return _procedures(_redacted(work_map))


def _procedures(work_map: Dict[str, Any]) -> List[Dict[str, Any]]:
    map_id = str(work_map.get("id") or "")
    guards = _guards(work_map)
    result = []
    for sid, first, s in _steps(work_map):
        mine = [g for _, g in guards if g.get("step") == sid] if first else []
        title = _step_title(s)
        result.append(
            {
                "id": f"{map_id}:{sid}",
                "name": title,
                "judgment": bool(s.get("judgment")),
                # Where in the work this step comes up; the guardrails carry their own conditions.
                "when": s.get("screen") or title,
                "do": s.get("decision") or "",
                "why": _why(s),
                "expert_words": _expert_words(s),
                "guardrails": [_guard_line(g) for g in mine],
                "stop_and_ask": [_stop_line(g) for g in mine if g.get("kind") == "stop_and_ask"],
            }
        )
    return result


def payload(work_map: Dict[str, Any]) -> Dict[str, Any]:
    """The knowledge-base document, the Procedures and the guardrails on no step."""
    work_map = _redacted(work_map)
    step_ids = {sid for sid, first, _ in _steps(work_map) if first}
    return {
        "work_map_id": str(work_map.get("id") or ""),
        "task": _task(work_map),
        "confirmed": work_map.get("status") == "confirmed",
        "knowledge_base": _knowledge_base_document(work_map),
        "procedures": _procedures(work_map),
        # Guardrails on no step (or on a step the map doesn't have) apply to the whole task.
        "general_guardrails": [
            _general(gid, g)
            for gid, g in _guards(work_map)
            if str(g.get("step") or "") not in step_ids
        ],
    }
