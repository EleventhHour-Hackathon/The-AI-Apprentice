"""Tie every step and guardrail to a screen moment and to the expert's own words.

The merge LLM proposes quotes and times; this decides what the map may claim:

- A quote counts only if the expert said it. Matching forgives what transcription
  changes (filler words, "five thousand" for "5,000", a sentence split over two lines),
  and the quote kept is the transcript's own text, never the LLM's copy.
- A step nobody gave a reason for still gets what the expert said while doing it
  (quote_kind "narration"), so it is never wordless; it is not shown as the reason.
- A guardrail takes its moment from what it is about: when it was said while working,
  else the step it belongs to. Only a guardrail tied to nothing keeps the LLM's guess,
  marked at_source "model" so the map can say the moment is approximate.
- Items the expert adds by voice in the debrief borrow the moment of the step they are about.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

FILLERS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "hmm", "mm", "mhm", "ah"}
# Units and currency are written either way ("€5,000", "5000 euros"); matching ignores them.
UNITS_DROPPED = {"€", "$", "%", "eur", "euro", "euros", "dollar", "dollars", "percent"}
NUMBERS = {
    w: n
    for n, w in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen "
        "fourteen fifteen sixteen seventeen eighteen nineteen".split()
    )
}
TENS = {w: 10 * n for n, w in enumerate("_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()) if n >= 2}
SCALES = {"thousand": 1_000, "million": 1_000_000}
TOKEN = re.compile(r"\d[\d,.]*\d|\d|[^\W\d_]+(?:'[^\W\d_]+)?|[€$%]")

# What the expert said within this many seconds of a step's span counts as said while doing it.
NARRATION_PAD_S = 5.0
NARRATION_WIDE_S = 15.0
NARRATION_MAX_CHARS = 240
# "Good." or "Sorry." is not something a new hire can learn from.
NARRATION_MIN_WORDS = 3
# A rule added by voice belongs to the step it shares at least this many content words with.
MIN_SHARED_WORDS = 2
STOPWORDS = set(
    "a an and are as at be but by do for from has have i if in is it its of on or so that the this "
    "to was we were what when where which who will with you your they them then there it's that's "
    "always never just only also into over under about".split()
)

Token = Tuple[str, int, int]  # normalised word, start and end in the original text


def tokens(text: str) -> List[Token]:
    """Words of a text as matching sees them, each with where it sits in the original."""
    raw = [(m.group(0).lower(), m.start(), m.end()) for m in TOKEN.finditer(text or "")]
    out: List[Token] = []
    i = 0
    while i < len(raw):
        word, start, end = raw[i]
        if word in FILLERS or word in UNITS_DROPPED:
            i += 1
            continue
        if word in NUMBERS or word in TENS:
            # A spelled-out number becomes its digits: "five thousand two hundred" -> "5200".
            total, current, j = 0, 0, i
            while j < len(raw):
                w = raw[j][0]
                if w in NUMBERS:
                    current += NUMBERS[w]
                elif w in TENS:
                    current += TENS[w]
                elif w == "hundred":
                    current = max(current, 1) * 100
                elif w in SCALES:
                    total += max(current, 1) * SCALES[w]
                    current = 0
                elif w == "and" and j + 1 < len(raw) and (raw[j + 1][0] in NUMBERS or raw[j + 1][0] in TENS):
                    pass
                else:
                    break
                end = raw[j][2]
                j += 1
            out.append((str(total + current), start, end))
            i = j
            continue
        if word[0].isdigit():
            word = word.replace(",", "")
            if word.endswith(".00"):
                word = word[:-3]
        out.append((word, start, end))
        i += 1
    return out


def match_quote(quote: str, lines: List[Dict[str, Any]]) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Find a quote in what was said: (the transcript's own words for it, the line it starts in).

    Looks in single lines first, then across two or three lines in a row.
    """
    wanted = [w for w, _, _ in tokens(quote)]
    if not wanted:
        return None
    per_line = [tokens(line.get("text") or "") for line in lines]
    for span in (1, 2, 3):
        for first in range(len(lines) - span + 1):
            window = [(k, tok) for k in range(first, first + span) for tok in per_line[k]]
            words = [tok[0] for _, tok in window]
            for at in range(len(words) - len(wanted) + 1):
                if words[at : at + len(wanted)] != wanted:
                    continue
                hit = window[at : at + len(wanted)]
                # Spanning lines must actually use each of them.
                if span > 1 and {k for k, _ in hit} != set(range(first, first + span)):
                    continue
                pieces = []
                for k in range(first, first + span):
                    used = [tok for line_k, tok in hit if line_k == k]
                    if used:
                        pieces.append(lines[k]["text"][used[0][1] : used[-1][2]])
                return " ".join(pieces), lines[first]
    return None


def ground_quote(item: Dict[str, Any], expert_lines: List[Dict[str, Any]]) -> bool:
    """Keep a quote only if the expert said it, in their words, with when and in which phase."""
    found = match_quote(item.get("quote") or "", expert_lines)
    if not found:
        item.update(quote="", quote_at=None, quote_source="none", quote_kind="none")
        return False
    text, line = found
    item.update(quote=text, quote_at=line.get("t"), quote_source=line.get("phase") or "live", quote_kind="reason")
    return True


def _clip(text: str) -> str:
    if len(text) <= NARRATION_MAX_CHARS:
        return text
    cut = text[:NARRATION_MAX_CHARS].rsplit(" ", 1)[0]
    return f"{cut}…"


def narrate(step: Dict[str, Any], live_lines: List[Dict[str, Any]]) -> None:
    """A step without a reason quote gets what the expert said while doing it, if anything."""
    at = step.get("at")
    if step.get("quote") or at is None:
        return
    timed = [
        l
        for l in live_lines
        if isinstance(l.get("t"), (int, float)) and len(_content_words(l.get("text"))) >= NARRATION_MIN_WORDS
    ]
    lo = (step.get("start") if step.get("start") is not None else at) - NARRATION_PAD_S
    hi = (step.get("end") if step.get("end") is not None else at) + NARRATION_PAD_S
    near = [l for l in timed if lo <= l["t"] <= hi] or [l for l in timed if abs(l["t"] - at) <= NARRATION_WIDE_S]
    if not near:
        return
    line = min(near, key=lambda l: abs(l["t"] - at))
    step.update(quote=_clip(line["text"].strip()), quote_at=line["t"], quote_source="live", quote_kind="narration")


def _snap(at: Optional[float], events: List[Dict[str, Any]]) -> Optional[float]:
    if at is None or not events:
        return at
    return min((e["t"] for e in events), key=lambda t: abs(t - at))


def place_guardrail(
    guard: Dict[str, Any], steps: Dict[str, Dict[str, Any]], events: List[Dict[str, Any]], guessed: Optional[float]
) -> None:
    """Set a guardrail's screen moment from what it is about, and say where it came from."""
    step = steps.get(guard.get("step") or "")
    said = _snap(guard.get("quote_at"), events) if guard.get("quote_source") == "live" else None
    if step and step.get("at") is not None:
        lo = step.get("start") if step.get("start") is not None else step["at"]
        hi = step.get("end") if step.get("end") is not None else step["at"]
        if said is not None and lo - NARRATION_PAD_S <= said <= hi + NARRATION_PAD_S:
            guard.update(at=said, at_source="said")
        elif guessed is not None and lo <= guessed <= hi:
            guard.update(at=guessed, at_source="step")
        else:
            guard.update(at=step["at"], at_source="step")
    elif said is not None:
        guard.update(at=said, at_source="said")
    else:
        guard.update(at=guessed, at_source="model" if guessed is not None else "none")


def _content_words(*texts: Any) -> set:
    return {w for w, _, _ in tokens(" ".join(str(t or "") for t in texts)) if w not in STOPWORDS and len(w) > 2}


def link_added(work_map: Dict[str, Any], item: Dict[str, Any], after_id: str = "") -> None:
    """An item the expert added by voice: give it the moment of the step it is about."""
    steps = [s for s in work_map.get("steps") or [] if s is not item]
    by_id = {s.get("id"): s for s in steps}
    if "rule" in item:
        if not item.get("step"):
            words = _content_words(item.get("rule"), item.get("applies_when"), item.get("ask_whom"), item.get("quote"))
            scored = [
                (len(words & _content_words(s.get("title"), s.get("decision"), s.get("reason"), s.get("screen"))), s)
                for s in steps
            ]
            best = max(scored, key=lambda pair: pair[0], default=(0, None))
            if best[1] is not None and best[0] >= MIN_SHARED_WORDS:
                item["step"] = best[1].get("id")
        step = by_id.get(item.get("step") or "")
        if step and step.get("at") is not None:
            item.update(at=step["at"], at_source="step")
        return
    # A new step sits next to the one it was added after (or the one before it in the list).
    neighbour = by_id.get(after_id)
    if neighbour is None:
        index = (work_map.get("steps") or []).index(item) if item in (work_map.get("steps") or []) else -1
        neighbour = work_map["steps"][index - 1] if index > 0 else None
    if neighbour and neighbour.get("at") is not None:
        item.update(at=neighbour["at"], start=None, end=None, at_source="nearby")


def unlinked(item: Dict[str, Any]) -> List[str]:
    """What a step or guardrail is missing: "moment" and/or "words"."""
    missing = []
    if item.get("at") is None:
        missing.append("moment")
    if not item.get("quote"):
        missing.append("words")
    return missing
