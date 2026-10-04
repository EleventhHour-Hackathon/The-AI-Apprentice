"""A Work Map as instructions another agent can load.

- to_markdown: a system prompt with the steps in order, the decision rules, each guardrail
  as a hard STOP rule, and the expert's own words.
- to_json: the same content as structured data for tool-using agents, with the Markdown
  under "instructions".

Both are pure: they read a stored Work Map and never touch the store. The stored text is
already redacted, but the export leaves the machine (and quotes can name colleagues), so every
free-text field is redacted again on the way out. Missing fields come out as "" or [], never None.
"""

import re
from typing import Any, Dict, List

from src.services.privacy import redact
from src.services.tutor import GUARD_KIND, _in_english, _step_title

DRAFT = "Draft: not confirmed by the expert."
NOBODY = "the person responsible"

PREAMBLE = (
    "You do this task the way the expert does it. Follow the steps in order and apply each "
    "decision rule to the case in front of you, not to the expert's example values. "
    "The guardrails are hard rules. When one applies, STOP: do not save, post, approve or send "
    "anything, and ask the person named before you go on. If you are unsure whether a guardrail "
    "applies, treat it as applying."
)


def _text(value: Any) -> str:
    """One line of text: "" for None, inner whitespace collapsed so it can't break the Markdown."""
    if value is None:
        return ""
    return " ".join(str(value).split())


def _free(value: Any) -> str:
    """Free text, redacted again because the export leaves the machine."""
    return redact(_text(value)) or ""


def _mid_sentence(text: str) -> str:
    """Lowercase the first letter to follow "when", unless it starts an acronym ("PO", "VAT")."""
    return text[0].lower() + text[1:] if len(text) > 1 and text[1].islower() else text


def _clause(value: Any) -> str:
    """Text to put mid-sentence: no trailing full stop."""
    return _text(value).rstrip(" .")


def _items(work_map: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    return [item for item in (work_map.get(key) or []) if isinstance(item, dict)]


def _steps(work_map: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for i, s in enumerate(_items(work_map, "steps"), 1):
        quote = _free(s.get("quote"))
        kind = _text(s.get("quote_kind"))
        out.append(
            {
                "id": _text(s.get("id")) or f"s{i}",
                "title": _free(_step_title(s)),
                "decision": _free(s.get("decision")),
                "reason": _free(s.get("reason")),
                "judgment": bool(s.get("judgment")),
                "expert_words": quote,
                # What they said while doing it is context, not a reason.
                "narration": kind == "narration" and bool(quote),
                "quote_kind": kind if kind in ("reason", "narration") and quote else "",
                "expert_words_english": _free(s.get("quote_translation")) if quote else "",
            }
        )
    return out


def _guardrails(work_map: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for i, g in enumerate(_items(work_map, "guardrails"), 1):
        quote = _free(g.get("quote"))
        kind = _text(g.get("kind"))
        out.append(
            {
                "id": _text(g.get("id")) or f"g{i}",
                "kind": kind,
                "rule": _free(g.get("rule")),
                "applies_when": _free(g.get("applies_when")),
                "ask_whom": _free(g.get("ask_whom")),
                "step": _text(g.get("step")),
                "expert_words": quote,
                "action": "stop_and_ask" if kind == "stop_and_ask" else "enforce",
                "expert_words_english": _free(g.get("quote_translation")) if quote else "",
            }
        )
    return out


def _open_questions(work_map: Dict[str, Any]) -> List[str]:
    return [q for q in (_free(q) for q in (work_map.get("open_questions") or [])) if q]


def _words(item: Dict[str, Any]) -> str:
    """The expert's quote, with its English translation if they said it in another language."""
    return f'"{item["expert_words"]}"' + _in_english(
        {"quote_translation": item["expert_words_english"]}
    )


def _guard_line(g: Dict[str, Any], step_numbers: Dict[str, int]) -> str:
    rule, when = _clause(g["rule"]), _clause(g["applies_when"])
    if g["action"] == "stop_and_ask":
        whom = _clause(g["ask_whom"]) or NOBODY
        line = (
            f"**STOP and ask {whom}** when {_mid_sentence(when or rule)}."
            if when or rule
            else f"**STOP and ask {whom}** before you go on."
        )
        if when and rule and rule.lower() != when.lower():
            line += f" Rule: {rule}."
    else:
        label = GUARD_KIND.get(g["kind"], "Rule").lower()
        line = f"**Hard rule ({label}):** {rule or 'follow the expert'}."
        if when:
            line += f" Applies when {_mid_sentence(when)}."
        if g["ask_whom"]:
            line += f" If it can't be followed, STOP and ask {_clause(g['ask_whom'])}."
    if g["step"]:
        where = (
            f"step {step_numbers[g['step']]}" if g["step"] in step_numbers else f"step {g['step']}"
        )
        line += f" (At {where}.)"
    return line


def to_markdown(work_map: Dict[str, Any]) -> str:
    """The Work Map as a Markdown system prompt for an agent."""
    task = _free(work_map.get("task")) or "Work Map"
    steps, guardrails, questions = (
        _steps(work_map),
        _guardrails(work_map),
        _open_questions(work_map),
    )

    lines = [f"# {task}", ""]
    if work_map.get("status") != "confirmed":
        lines += [f"> {DRAFT}", ""]
    lines += [PREAMBLE, ""]

    lines += ["## Steps", ""]
    if not steps:
        lines.append("No steps were recorded.")
    for n, s in enumerate(steps, 1):
        head = f"{n}. **{s['title'] or 'Step ' + str(n)}**"
        if s["judgment"]:
            head += " (judgment call)"
        lines.append(head)
        if s["decision"]:
            lines.append(f"   - Decision: {s['decision']}")
        if s["expert_words"] and not s["narration"]:
            lines.append(f"   - Why, in the expert's words: {_words(s)}")
        elif s["reason"]:
            lines.append(f"   - Why: {s['reason']}")
        if s["narration"]:
            lines.append(f"   - Said while doing it (context, not a reason): {_words(s)}")

    lines += ["", "## Guardrails", ""]
    if not guardrails:
        lines.append("No guardrails were recorded.")
    step_numbers = {s["id"]: n for n, s in enumerate(steps, 1)}
    for g in guardrails:
        lines.append(f"- {_guard_line(g, step_numbers)}")
        if g["expert_words"]:
            lines.append(f"  - The expert's words: {_words(g)}")

    if questions:
        lines += [
            "",
            "## Open questions",
            "",
            "The expert has not answered these yet. If your case depends on one, STOP and ask.",
            "",
        ]
        lines += [f"- {q}" for q in questions]

    return "\n".join(lines) + "\n"


def to_json(work_map: Dict[str, Any]) -> Dict[str, Any]:
    """The Work Map for tool-using agents: the same content as to_markdown, structured."""
    steps = [
        {
            k: s[k]
            for k in (
                "id",
                "title",
                "decision",
                "reason",
                "judgment",
                "expert_words",
                "expert_words_english",
                "quote_kind",
            )
        }
        for s in _steps(work_map)
    ]
    guardrails = [
        {
            k: g[k]
            for k in (
                "id",
                "kind",
                "rule",
                "applies_when",
                "ask_whom",
                "step",
                "expert_words",
                "expert_words_english",
                "action",
            )
        }
        for g in _guardrails(work_map)
    ]
    return {
        "work_map_id": _text(work_map.get("id")),
        "task": _free(work_map.get("task")),
        "confirmed": work_map.get("status") == "confirmed",
        "steps": steps,
        "guardrails": guardrails,
        "open_questions": _open_questions(work_map),
        "instructions": to_markdown(work_map),
    }


def filename(work_map: Dict[str, Any]) -> str:
    """A download name from the task, ASCII only so it fits in a header: "<task slug>.agent.md"."""
    slug = re.sub(r"[^a-z0-9]+", "-", _free(work_map.get("task")).lower()).strip("-")
    return f"{slug or 'work-map'}.agent.md"
