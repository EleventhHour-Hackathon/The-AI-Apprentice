"""Does a confirmed Work Map already cover what the expert is doing on screen right now?

The always-on apprentice watches everyday work and should speak up only for a case it has
never seen. This is the check behind that: one screen event in, one verdict out.

- An event is covered when it carries enough of one step (title, screen, decision) or one
  rule (rule, condition) of a confirmed Work Map. The score is one-sided: how much of the
  item is in the event, not how alike the two are, so a specific event ("Opened invoice 4482
  from Kovotech s.r.o.") isn't held back by the detail it adds to "Open the supplier invoice".
  Words are compared after a light English stem (opened, opening -> open).
- The best item wins, and the answer names its map and item so the apprentice can say what
  it is following. Items flagged as no longer done ("removed") don't cover anything.
- An event no item covers is novel and comes with one short question for the expert. The
  question quotes the event redacted and trimmed, never anything from the maps.
- Events with almost no words ("Scrolled", "Idle") are ignored: there is nothing to judge.

No LLM, so the same event against the same maps always gives the same verdict, and the
shared words explain it. Word overlap can't tell a new case that reuses an item's words
("Opened a credit note from supplier Bauer" against "Open the supplier invoice") from a
routine one; that is the price of being deterministic. Nothing calls this live yet: the
novel-case inbox (B-11) and stopping the autopilot at uncovered cases (B-56) build on it.
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple

from src.services import privacy
from src.services.diff_questions import trim
from src.services.work_map_diff import similarity
from src.services.work_map_links import STOPWORDS, tokens

# The score is the share of an item's words found in the event, counting at most ENOUGH_WORDS
# of them: an event naming three words of a step is as covered as it gets, however long the
# step's decision is. Two shared words of a longer item give .667, one gives .333.
ENOUGH_WORDS = 3
# An event is covered from this score up. Measured on hand-written screen events against an
# invoice-coding map and a travel-expense map (CALIBRATION in tests/test_coverage.py):
# - routine events scored 1.0 (open the invoice in DATEV, VAT ID check, cost centre, posting
#   in SAP, the over-5,000 rule, a hotel receipt, an expense report) or .667 (opened invoices
#   from Bauer Hydraulik and Kovotech, "Posted invoice 4474 from Büro Hansen");
# - new cases scored .333 (a USD invoice, onboarding a freelance translator, a GDPR request,
#   a credit note, changed bank details, a dunning letter): one word in common at most.
# .6 sits between: an event needs two of an item's words, or all of a shorter one.
COVERED = 0.6
# Fewer content words than this and the event says nothing to judge.
MIN_WORDS = 2
MAX_LABEL = 80
NOVEL_QUESTION = "I haven't seen {label} before. How do you handle it?"

# Scripts written without spaces: one token is a whole phrase, so count it by its length.
NO_SPACES = re.compile(
    r"[\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]"
)
ASCII_WORD = re.compile(r"[a-z]+")

Match = Dict[str, Any]


def stem(word: str) -> str:
    """A light English stem so tenses and plurals meet: open, opens, opened, opening -> open.

    Only plain a-z words longer than three letters are touched; other languages pass as they
    are. Crude on purpose: both sides go through it, so it only has to be consistent.
    """
    if not ASCII_WORD.fullmatch(word) or len(word) <= 3:
        return word
    if word.endswith("ies") and len(word) > 4:
        word = word[:-3] + "y"
    elif word.endswith("s") and not word.endswith("ss"):
        word = word[:-1]
    for suffix in ("ing", "ed"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            if len(word) > 3 and word[-1] == word[-2] and word[-1] not in "lsz":
                word = word[:-1]  # stopped -> stop
            elif len(word) == 3 and word[1] in "aeiou" and word[2] not in "aeiouwxy":
                word += "e"  # coded -> code, noted -> note
            break
    if word.endswith("e") and len(word) > 4:
        word = word[:-1]  # invoice, invoiced -> invoic
    return word


def stems(text: Any) -> Set[str]:
    """Stemmed content words of a text: no numbers, stopwords, fillers or single letters."""
    out = set()
    for word, _, _ in tokens(str(text or "")):
        if word[0].isdigit() or word in STOPWORDS or len(word) < 2:
            continue
        out.add(stem(word[:-2] if word.endswith("'s") else word))
    return out


def content_words(text: str) -> int:
    """How many content words a text has (no numbers or stopwords), to tell if it says enough."""
    count = 0
    for word, _, _ in tokens(str(text or "")):
        if word[0].isdigit() or word in STOPWORDS:
            continue
        count += max(1, len(word) // 2) if NO_SPACES.search(word) else 1
    return count


def contained(event_words: Set[str], item_words: Set[str]) -> float:
    """The share of an item's words in the event, counting at most ENOUGH_WORDS of them."""
    if not item_words:
        return 0.0
    return min(1.0, len(event_words & item_words) / min(len(item_words), ENOUGH_WORDS))


def _items(work_map: Dict[str, Any]) -> List[Tuple[str, str, str, str]]:
    """(section, id, title, text) of each item still done, steps first, in map order."""
    out = []
    for n, step in enumerate(work_map.get("steps") or [], 1):
        if step.get("removed"):
            continue
        parts = [step.get("title"), step.get("screen"), step.get("decision")]
        text = " ".join(str(p) for p in parts if p)
        out.append(("steps", str(step.get("id") or f"s{n}"), str(step.get("title") or ""), text))
    for n, rule in enumerate(work_map.get("guardrails") or [], 1):
        if rule.get("removed"):
            continue
        parts = [rule.get("rule"), rule.get("applies_when")]
        text = " ".join(str(p) for p in parts if p)
        out.append(
            ("guardrails", str(rule.get("id") or f"g{n}"), str(rule.get("rule") or ""), text)
        )
    return out


def best_match(event_text: str, maps: List[Dict[str, Any]]) -> Optional[Match]:
    """The item that covers the event most, or None when no map has an item.

    Many items can be fully in an event, so equal scores go to the item more like the event
    as a whole (similarity()), then to the earlier map, steps before rules, the earlier item.
    """
    event_words = stems(event_text)
    best: Optional[Match] = None
    best_key: Tuple[float, float] = (-1.0, -1.0)
    for work_map in maps:
        for section, item_id, title, text in _items(work_map):
            key = (round(contained(event_words, stems(text)), 3), similarity(event_text, text))
            if key > best_key:
                best_key = key
                best = {
                    "work_map_id": str(work_map.get("id") or ""),
                    "task": str(work_map.get("task") or ""),
                    "section": section,
                    "item_id": item_id,
                    "title": title,
                    "score": key[0],
                }
    return best


def question(event_text: str) -> str:
    """The one question to ask the expert about a case no Work Map covers."""
    label = trim(privacy.redact(str(event_text or "")).strip().rstrip("."), MAX_LABEL)
    return NOVEL_QUESTION.format(label=f"'{label}'")


def check(event_text: str, maps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Covered (by which map and item, how sure), novel (with a question), or ignored."""
    if content_words(event_text) < MIN_WORDS:
        return {"verdict": "ignored"}
    best = best_match(event_text, maps)
    if best is not None and best["score"] >= COVERED:
        return {"verdict": "covered", **best}
    return {"verdict": "novel", "question": question(event_text), "best": best}
