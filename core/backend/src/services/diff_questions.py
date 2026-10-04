"""Questions for each expert, made from where two Work Maps of one task differ.

work_map_diff.diff() says where two experts parted; this turns that into a short list of
questions the apprentice can say aloud to each of them. No LLM; fixed English templates, so
the same diff always gives the same questions:

- Each question quotes the asked expert's own words (the English translation of their quote,
  else the quote, else their reason) and says what was done "in another session". The other
  expert is never named, and a question without words to quote leaves the quote out.
- A matched pair that differs gives one question per side, about its most telling field; the
  other fields fold into that one, so no item is asked about twice. Both sides get a
  question with the same id, also when one of them left the field empty: the empty side is
  asked for theirs, the other side whether theirs always holds. When the next field down is
  a hard one too (numbers, rule, kind, person to ask, judgment call), one short sentence says
  so ("The person to ask differs too.").
- Numbers name only those that differ: with 0400 and 5,000 against 0400 and 10,000 the
  question is about 5,000 against 10,000.
- Rules on a step and the step a rule comes in at are named by their own text, looked up in
  the diff itself (at most two rules, then "and N more"); without a name the question says
  "2 rules" or "a different step" instead.
- A step or rule only one expert has asks that expert when it is needed.

Ranking, best first: a different number, a flipped rule, a different kind of rule, a
different person to ask, a judgment call or not, a field one side left empty, different
rules on a step, a rule on a different step; then items only one expert has; last a
reworded decision, reason or condition. Rewording is the noisiest signal: two experts often
say the same thing in other words, while a changed number or a flipped rule is a real
disagreement. Ties go to rules before steps, then to the closer match, then to diff order.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

Question = Dict[str, Any]

# Lower asks first. Text fields left empty on one side rank at "missing" instead.
PRIORITY = {
    "numbers": 0,
    "rule": 1,
    "kind": 2,
    "ask_whom": 3,
    "judgment": 4,
    "missing": 5,
    "guardrails": 6,
    "step": 7,
    "only": 8,
    "decision": 9,
    "reason": 10,
    "applies_when": 11,
}
TEXT_FIELDS = {"decision", "reason", "applies_when"}
SECTIONS = ("guardrails", "steps")
# Long values are cut at a word boundary near this many characters; rule names in a list
# shorter, and at most MAX_NAMES of them before "and N more".
MAX_CHARS = 80
NAME_CHARS = 50
MAX_NAMES = 2

KINDS = {
    "limit": "a hard limit",
    "exception": "an exception",
    "stop_and_ask": "a point to stop and ask",
}

# Per field: (both sides said something, the asked side left it empty, the other side did).
# {mine} is the asked expert's value, {theirs} the other session's.
TEMPLATES: Dict[str, Tuple[str, str, str]] = {
    "numbers": (
        "You went with {mine}; in another session it was {theirs}. Which holds, and when?",
        "In another session the number here was {theirs}. Is there one for you?",
        "You went with {mine}; in another session no number was given. Does it always hold?",
    ),
    "rule": (
        'Your rule is "{mine}"; in another session it was "{theirs}". Which is right, and when?',
        'In another session the rule was "{theirs}". What\'s yours?',
        'Your rule is "{mine}"; in another session there was none. When does it apply?',
    ),
    "kind": (
        "You treat this as {mine}; in another session it was {theirs}. Why?",
        "In another session this was {theirs}. What is it for you?",
        "You treat this as {mine}; in another session that wasn't said. Why?",
    ),
    "ask_whom": (
        "You would ask {mine}; in another session it was {theirs}. Who should it be, and why?",
        "In another session the person to ask was {theirs}. Who do you ask?",
        "You would ask {mine}; in another session no one was named. Why them?",
    ),
    "guardrails": (
        "You had {mine} here; in another session the rules here were different. "
        "Which ones apply, and why?",
        "In another session {theirs} applied here. Do any apply for you?",
        "You had {mine} here; in another session there were none. Why do they matter here?",
    ),
    "step": (
        "In another session this rule came in at a different step. "
        "Where does it come in for you, and why?",
        "In another session this rule came in at a particular step. Where does it come in for you?",
        "You tied this rule to a step; in another session it wasn't tied to one. Why there?",
    ),
    "decision": (
        'You decided "{mine}"; in another session it was "{theirs}". Why?',
        'In another session the decision was "{theirs}". What did you decide here?',
        'You decided "{mine}"; in another session no decision was noted. Why that?',
    ),
    "reason": (
        'Your reason was "{mine}"; in another session it was "{theirs}". Which matters more here?',
        'In another session the reason given was "{theirs}". What\'s yours?',
        'Your reason was "{mine}"; in another session none was given. Is that always why?',
    ),
    "applies_when": (
        "You apply this when {mine}; in another session, when {theirs}. When does it really apply?",
        "In another session this applied when {theirs}. When does it apply for you?",
        "You apply this when {mine}; in another session no condition was given. "
        "Does it always apply?",
    ),
}
# Judgment reads like kind: "You treat this as a judgment call; in another session it was routine."
TEMPLATES["judgment"] = TEMPLATES["kind"]
# The step a rule comes in at, when the steps have titles; else TEMPLATES["step"].
STEP_NAMED = (
    'You tied this rule to "{mine}"; in another session it came in at "{theirs}". '
    "Where does it come in, and why?",
    'In another session this rule came in at "{theirs}". Where does it come in for you?',
    'You tied this rule to "{mine}"; in another session it wasn\'t tied to one. Why there?',
)

# Said after the question when the pair's next field by priority differs as well.
ALSO = {
    "numbers": "The numbers differ too.",
    "rule": "The rule reads the other way too.",
    "kind": "The kind of rule differs too.",
    "ask_whom": "The person to ask differs too.",
    "judgment": "Whether it's a judgment call differs too.",
}

ONLY = {
    "steps": (
        'You did "{title}"; in another session this step wasn\'t there. When is it needed?',
        "You did a step another session didn't have. When is it needed?",
    ),
    "guardrails": (
        'Your rule "{title}" didn\'t come up in another session. When does it apply?',
        "You had a rule that didn't come up in another session. When does it apply?",
    ),
}
FALLBACK_TITLE = {"steps": "this step", "guardrails": "this rule"}


def _empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return not value
    return False


def trim(text: Any, limit: int = MAX_CHARS) -> str:
    """One line of text, cut at a word boundary near limit characters, with "..." if cut."""
    text = " ".join(str(text or "").split())
    if len(text) <= limit:
        return text
    cut = text[: limit + 1].rsplit(" ", 1)[0] if " " in text[: limit + 1] else text[:limit]
    return cut.rstrip(" ,;:.") + "..."


def _inner(text: Any) -> str:
    """Text quoted inside a sentence: trimmed, and without the full stop the sentence adds."""
    return trim(" ".join(str(text or "").split()).rstrip(".;:,"))


def number(n: Any) -> str:
    """A number as people say it: "5000" becomes "5,000"; anything else is kept as it is.

    A leading zero marks a code, not an amount (account "0400"), so it is kept too.
    """
    s = str(n).strip()
    if s.startswith("0") and len(s) > 1 and s[1].isdigit():
        return s
    if re.fullmatch(r"\d+", s):
        return f"{int(s):,}"
    m = re.fullmatch(r"(\d+)\.(\d+)", s)
    if m:
        return f"{int(m.group(1)):,}.{m.group(2)}"
    return s


def _and(parts: List[str]) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def _as_list(value: Any) -> List[Any]:
    if isinstance(value, (list, tuple, set)):
        return [v for v in value if not _empty(v)]
    return [] if _empty(value) else [value]


# Per section, an item id to its title (steps) or rule text (guardrails), for one side.
Labels = Dict[str, Dict[str, str]]


def _rules(ids: List[Any], labels: Optional[Labels]) -> str:
    """Rules named in quotes, at most MAX_NAMES, then "and N more"; else "one rule"/"N rules"."""
    names = (labels or {}).get("guardrails", {})
    named = [names.get(str(i), "") for i in ids]
    named = [trim(" ".join(n.split()).rstrip(".;:,"), NAME_CHARS) for n in named if n.strip()]
    if not named:
        return "one rule" if len(ids) == 1 else f"{len(ids)} rules"
    shown = [f'"{n}"' for n in named[:MAX_NAMES]]
    rest = len(ids) - len(shown)
    return _and(shown + ([f"{rest} more"] if rest else []))


def _say(field: str, value: Any, labels: Optional[Labels] = None) -> str:
    """A field's value the way the apprentice says it."""
    if field == "numbers":
        return _and([number(v) for v in _as_list(value)])
    if field == "kind":
        return KINDS.get(str(value), str(value).replace("_", " "))
    if field == "judgment":
        return "a judgment call" if value else "routine"
    if field == "guardrails":
        return _rules(_as_list(value), labels)
    if field == "step":
        # The step's title, or "" when it has none (the question then doesn't name it).
        if _empty(value):
            return ""
        return _inner((labels or {}).get("steps", {}).get(str(value), ""))
    if isinstance(value, (list, tuple, set)):
        return trim(", ".join(str(v) for v in value))
    return _inner(value)


def _words(entry: Dict[str, Any], key: str) -> str:
    """The expert's own words to quote: the translation, else the quote, else the reason."""
    words = entry.get(key)
    if not isinstance(words, dict):
        return ""
    for name in ("quote_translation", "quote", "reason"):
        text = " ".join(str(words.get(name) or "").split())
        if text:
            return text
    return ""


def _sentence(quote: str) -> str:
    """'You said "...".' with the quote cut short and ending in a full stop."""
    said = trim(quote)
    if not said.endswith((".", "!", "?", "...", "。", "？", "！")):
        said += "."
    return f'You said "{said}"'


def _lower_first(text: str) -> str:
    return text[:1].lower() + text[1:]


def _field_question(
    section: str,
    f: Dict[str, Any],
    mine: Any,
    theirs: Any,
    title: str,
    quote: str,
    labels: Tuple[Optional[Labels], Optional[Labels]] = (None, None),
    also: str = "",
) -> Optional[Tuple[str, str]]:
    """The text of one side's question about one field, and the words it quotes.

    labels are the asked side's and the other side's; also is a sentence said after the question.
    """
    field = str(f.get("field") or "")
    if field not in TEMPLATES or (_empty(mine) and _empty(theirs)):
        return None
    if field == "numbers" and not _empty(mine) and not _empty(theirs):
        # Only the numbers that differ; a side left with none keeps its full list.
        mine_all, theirs_all = _as_list(mine), _as_list(theirs)
        mine = [n for n in mine_all if n not in theirs_all] or mine_all
        theirs = [n for n in theirs_all if n not in mine_all] or theirs_all
    said_mine, said_theirs = _say(field, mine, labels[0]), _say(field, theirs, labels[1])
    changed, mine_empty, theirs_empty = TEMPLATES[field]
    if field == "step":
        # Name the steps when every step the sentence mentions has a title.
        changed = STEP_NAMED[0] if said_mine and said_theirs else changed
        mine_empty = STEP_NAMED[1] if said_theirs else mine_empty
        theirs_empty = STEP_NAMED[2] if said_mine else theirs_empty
    if _empty(mine):
        template = mine_empty
    elif _empty(theirs):
        template = theirs_empty
    else:
        template = changed
    body = template.format(mine=said_mine, theirs=said_theirs)
    if also:
        body = f"{body} {also}"
    # Words quoted up front would be said twice when the question is about those very words
    # (a reason): then the question names the item instead, and the body quotes them.
    if quote and quote != " ".join(str(mine or "").split()):
        return f"{_sentence(quote)} {body}", quote
    lead = f'On "{_inner(title)}"' if title.strip() else f"On {FALLBACK_TITLE[section]}"
    return f"{lead}, {_lower_first(body)}", quote


def _priority(f: Dict[str, Any]) -> int:
    field = str(f.get("field") or "")
    if field in TEXT_FIELDS and (_empty(f.get("a")) or _empty(f.get("b"))):
        return PRIORITY["missing"]
    return PRIORITY.get(field, len(PRIORITY))


def _list(d: Any, section: str, key: str) -> List[Dict[str, Any]]:
    part = d.get(section) if isinstance(d, dict) else None
    items = part.get(key) if isinstance(part, dict) else None
    return [it for it in items or [] if isinstance(it, dict)]


def _score(entry: Dict[str, Any]) -> float:
    try:
        return float(entry.get("score") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _id(value: Any) -> str:
    return "-" if _empty(value) else str(value)


Candidate = Tuple[Tuple[int, int, float, int], Question]


def _also(rest: List[Dict[str, Any]]) -> str:
    """The sentence for the next field down, when it is a hard one with a value on a side."""
    for f in rest:
        if _empty(f.get("a")) and _empty(f.get("b")):
            continue
        field = str(f.get("field") or "")
        return "" if field in TEXT_FIELDS else ALSO.get(field, "")
    return ""


def _differs(
    section: str, order: int, entry: Dict[str, Any], labels: Dict[str, Labels]
) -> Dict[str, Candidate]:
    """One question per side about the pair's most telling field, keyed by side."""
    fields = [f for f in entry.get("fields") or [] if isinstance(f, dict)]
    fields.sort(key=_priority)  # stable: diff's field order breaks ties
    id_a, id_b = _id(entry.get("a")), _id(entry.get("b"))
    for k, f in enumerate(fields):
        out: Dict[str, Candidate] = {}
        also = _also(fields[k + 1 :])
        for side, other in (("a", "b"), ("b", "a")):
            asked = _field_question(
                section,
                f,
                f.get(side),
                f.get(other),
                str(entry.get(f"title_{side}") or entry.get(f"title_{other}") or ""),
                _words(entry, f"words_{side}"),
                (labels[side], labels[other]),
                also,
            )
            if asked is None:
                continue
            text, quote = asked
            field = str(f.get("field"))
            rank = (_priority(f), SECTIONS.index(section), -_score(entry), order)
            out[side] = (
                rank,
                {
                    "id": f"{section}:{id_a}:{id_b}:{field}",
                    "section": section,
                    "item": id_a if side == "a" else id_b,
                    "other": id_b if side == "a" else id_a,
                    "field": field,
                    "text": text,
                    "quote": quote,
                },
            )
        if out:
            return out
    return {}


def _only(section: str, side: str, order: int, entry: Dict[str, Any]) -> Candidate:
    """Ask the one expert who has this item when it is needed."""
    item = _id(entry.get("id"))
    title = str(entry.get("title") or "").strip()
    with_title, without = ONLY[section]
    body = with_title.format(title=_inner(title)) if title else without
    words = entry.get("words") if isinstance(entry.get("words"), dict) else {}
    quote = _words({"words": words}, "words")
    text = f"{_sentence(quote)} {body}" if quote else body
    rank = (PRIORITY["only"], SECTIONS.index(section), 0.0, order)
    ids = (item, "-") if side == "a" else ("-", item)
    return (
        rank,
        {
            "id": f"{section}:{ids[0]}:{ids[1]}:only",
            "section": section,
            "item": item,
            "other": None,
            "field": "only",
            "text": text,
            "quote": quote,
        },
    )


def _labels(d: Any, side: str) -> Labels:
    """One side's step titles and rule texts by id, from every list in the diff."""
    out: Labels = {}
    for section in SECTIONS:
        names: Dict[str, str] = {}
        for entry in _list(d, section, "same"):
            names[_id(entry.get(side))] = str(entry.get("title") or "")
        for entry in _list(d, section, "differs"):
            names[_id(entry.get(side))] = str(entry.get(f"title_{side}") or "")
        for entry in _list(d, section, f"only_{side}"):
            names[_id(entry.get("id"))] = str(entry.get("title") or "")
        out[section] = {k: v for k, v in names.items() if k != "-" and v.strip()}
    return out


def questions(d: Dict[str, Any], limit: int = 5) -> Dict[str, List[Question]]:
    """For each expert, up to limit questions about where their map differs, best first."""
    found: Dict[str, List[Candidate]] = {"a": [], "b": []}
    labels = {"a": _labels(d, "a"), "b": _labels(d, "b")}
    for section in SECTIONS:
        order = 0
        for entry in _list(d, section, "differs"):
            for side, candidate in _differs(section, order, entry, labels).items():
                found[side].append(candidate)
            order += 1
        for side in ("a", "b"):
            for entry in _list(d, section, f"only_{side}"):
                found[side].append(_only(section, side, order, entry))
                order += 1

    def pick(candidates: List[Candidate]) -> List[Question]:
        out: List[Question] = []
        seen = set()
        for _, q in sorted(candidates, key=lambda c: c[0]):
            key = (q["section"], q["item"])
            if key in seen or len(out) >= max(limit, 0):
                continue
            seen.add(key)
            out.append(q)
        return out

    return {"a": pick(found["a"]), "b": pick(found["b"])}
