"""Compare two experts' Work Maps of the same task: what they share, where they part, and who
did something the other didn't.

No LLM is involved; the answer has to be the same every time and explainable:

- Two items are the same step (or the same rule) when their words overlap enough. The words are
  the map's own English text plus the English translation of the quote, never the raw quote, so
  two experts speaking different languages still compare.
- Numbers don't count toward that overlap ("over 5,000" and "over 10,000" are the same rule), but
  a changed number is reported on its own: a different threshold is a real disagreement.
- Steps pair one-to-one, best match first, and keep the order of both maps unless a moved step
  is clearly the same step. Leftovers that sit in the same place in both maps, between two
  paired neighbours, pair on a much lower score.
- A field differs only when it says something different. Rewording, case and punctuation don't
  count, and a field one expert left empty is "missing", not a disagreement. Words that flip
  or bound a rule (never and always, over and under, not) always count.
- Each item carries the expert's own words (quote, its translation, the reason) so a follow-up
  can ask each expert why.

similarity() is the shared text-likeness helper; reuse it rather than writing another.
"""

from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from src.services.work_map_links import STOPWORDS, tokens

# Two steps with at least this similarity are paired outright. On two paraphrased invoice maps
# the right pairs scored .67/.11/.38/.35/.71/.50 and different steps at most .22 in English
# (.33 in German, which one-to-one pairing blocks).
STEP_MATCH = 0.3
# Related rules scored .27 and .62, different rules at most .14.
RULE_MATCH = 0.25
# A pair that breaks the order of both maps is taken only from this score up: clearly the same
# item, moved. Below it, a pair must keep the order of the pairs already made.
MOVED_MATCH = 0.6
# Between two paired neighbours, leftovers that keep the order pair from this score up when
# each is the other's best: "Check supplier" and "Verify vendor" share little but sit in the
# same place (.11 in English, .18 and .22 in German).
GAP_MATCH = 0.1
# Two texts in a field say the same thing when they carry the same numbers and polarity words
# and this share of the shorter one's content words is in the other. Rewordings measured .67
# to 1.0; real disagreements .5 or less (capex vs opex, approve vs reject).
FIELD_OVERLAP = 0.6
# Words that flip or bound a rule. STOPWORDS drops several of them ("never", "over"), which is
# right for pairing items but not for saying two fields agree. Synonyms fold to one word.
# "before" and "after" are left out: rewording drops them often, and a timing difference shows
# up through step pairing and field overlap anyway.
POLARITY = {
    "not": "not",
    "no": "not",
    "never": "not",
    "always": "always",
    "only": "only",
    "without": "without",
    "unless": "unless",
    "except": "except",
    "over": "over",
    "above": "over",
    "more": "over",
    "under": "under",
    "below": "under",
    "less": "under",
    "fewer": "under",
}

Pair = Tuple[int, int, float]


def _word(word: str) -> str:
    """A crude plural fold so "invoices" meets "invoice"."""
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _words(text: Any) -> List[str]:
    """Content words of a text without numbers, as similarity compares them."""
    out = []
    for w, _, _ in tokens(str(text or "")):
        if w[0].isdigit() or w in STOPWORDS:
            continue
        out.append(_word(w))
    return out


def numbers(*texts: Any) -> List[str]:
    """The numbers in some texts, as digits ("five thousand" and "5,000" are both "5000")."""
    found = {w for t in texts for w, _, _ in tokens(str(t or "")) if w[0].isdigit()}

    def value(n: str) -> float:
        try:
            return float(n)
        except ValueError:
            return float("inf")

    return sorted(found, key=lambda n: (value(n), n))


def _dice(sa: Set[str], sb: Set[str]) -> float:
    return round(2 * len(sa & sb) / (len(sa) + len(sb)), 3)


def similarity(a: str, b: str) -> float:
    """How alike two texts are, from 0 (no content word shared) to 1 (the same content words).

    The Dice overlap of the two sets of content words, 2|A&B| / (|A| + |B|); word order doesn't
    count. Stopwords, fillers, currency units and numbers are left out; compare numbers with
    numbers(). Symmetric and deterministic. Empty text resembles nothing (0.0).
    """
    wa, wb = set(_words(a)), set(_words(b))
    if not wa or not wb:
        # Only numbers or stopwords: alike only if they are literally the same.
        same = _norm(a) and _norm(a) == _norm(b)
        return 1.0 if same else 0.0
    return _dice(wa, wb)


def _norm(text: Any, keep_numbers: bool = True) -> str:
    """A field's words with case, punctuation and filler gone, for "says the same" checks."""
    words = [_word(w) for w, _, _ in tokens(str(text or "")) if keep_numbers or not w[0].isdigit()]
    content = [w for w in words if w not in STOPWORDS]
    return " ".join(content or words)


def _empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _polarity(text: Any) -> Set[str]:
    """The words that flip or bound what a text says ("don't" counts as "not")."""
    out = set()
    for w, _, _ in tokens(str(text or "")):
        w = "not" if w.endswith("n't") else w
        if w in POLARITY:
            out.add(POLARITY[w])
    return out


def _says_same(a: Any, b: Any, keep_numbers: bool = True) -> bool:
    """Two field texts agree: same polarity, same numbers (if kept) and mostly the same words."""
    if _polarity(a) != _polarity(b):
        return False
    if keep_numbers and numbers(a) != numbers(b):
        return False
    if _norm(a, keep_numbers=False) == _norm(b, keep_numbers=False):
        return True
    wa = set(_words(a)) - set(POLARITY)
    wb = set(_words(b)) - set(POLARITY)
    if not wa or not wb:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= FIELD_OVERLAP


def _field(name: str, a: Any, b: Any, same: Callable[[Any, Any], bool]) -> Optional[Dict]:
    """One field's difference, or None when both sides say the same (or both say nothing)."""
    if _empty(a) and _empty(b):
        return None
    if _empty(a) or _empty(b):
        kind = "missing_a" if _empty(a) else "missing_b"
        return {
            "field": name,
            "kind": kind,
            "a": None if _empty(a) else a,
            "b": None if _empty(b) else b,
        }
    if same(a, b):
        return None
    return {"field": name, "kind": "changed", "a": a, "b": b}


def _ids(items: List[Dict[str, Any]], prefix: str) -> List[str]:
    return [str(it.get("id") or f"{prefix}{i}") for i, it in enumerate(items, 1)]


def _title(step: Dict[str, Any]) -> str:
    return str(step.get("title") or step.get("step") or "")


def _step_text(step: Dict[str, Any]) -> str:
    parts = (_title(step), step.get("decision"), step.get("reason"), step.get("quote_translation"))
    return " ".join(str(p or "") for p in parts)


def _rule_text(guard: Dict[str, Any]) -> str:
    parts = ("rule", "applies_when", "ask_whom", "quote_translation")
    return " ".join(str(guard.get(p) or "") for p in parts)


def _words_of(item: Dict[str, Any]) -> Dict[str, str]:
    """The expert's own words for an item. A narration quote is not a reason, so it is left out."""
    narration = item.get("quote_kind") == "narration"
    return {
        "quote": "" if narration else str(item.get("quote") or ""),
        "quote_translation": "" if narration else str(item.get("quote_translation") or ""),
        "reason": str(item.get("reason") or ""),
    }


def _crosses(i: int, j: int, taken: List[Pair]) -> bool:
    return any((i - ti) * (j - tj) < 0 for ti, tj, _ in taken)


def _match(
    texts_a: List[str],
    texts_b: List[str],
    threshold: float,
    tie: Optional[Callable[[int, int], int]] = None,
) -> List[Pair]:
    """Pair items one-to-one, best score first, at or above threshold, then fill the gaps.

    Ties go to the pair with tie(i, j) == 0, then to the one nearest the same place in both
    maps, then by the texts themselves, so diff(b, a) mirrors diff(a, b). A pair that crosses
    one already made (a moved item) needs MOVED_MATCH. Last, _fill_gaps pairs what is left
    between two paired neighbours.
    """
    na, nb = len(texts_a), len(texts_b)
    sets_a = [set(_words(t)) for t in texts_a]
    sets_b = [set(_words(t)) for t in texts_b]
    scores = [
        [
            _dice(sa, sb) if sa and sb else similarity(texts_a[i], texts_b[j])
            for j, sb in enumerate(sets_b)
        ]
        for i, sa in enumerate(sets_a)
    ]
    ranked = []
    for i in range(na):
        for j in range(nb):
            if scores[i][j] >= threshold:
                place = abs(i / na - j / nb)
                texts = tuple(sorted((texts_a[i], texts_b[j])))
                ranked.append((-scores[i][j], tie(i, j) if tie else 0, place, texts, i, j))
    taken: List[Pair] = []
    used_a: Set[int] = set()
    used_b: Set[int] = set()
    for *_, i, j in sorted(ranked):
        if i in used_a or j in used_b:
            continue
        if scores[i][j] < MOVED_MATCH and _crosses(i, j, taken):
            continue
        taken.append((i, j, scores[i][j]))
        used_a.add(i)
        used_b.add(j)
    return sorted(taken + _fill_gaps(scores, taken))


def _fill_gaps(scores: List[List[float]], taken: List[Pair]) -> List[Pair]:
    """Pair leftovers that sit in the same gap of both maps.

    A gap is the run of unpaired items between two paired neighbours (or a map's end). Inside
    it, a pair keeps the order, is each item's best score in the gap and scores GAP_MATCH.
    """
    na = len(scores)
    nb = len(scores[0]) if scores else 0
    # Anchors are the pairs that keep the order; a moved pair doesn't bound a gap.
    anchors = [(-1, -1)]
    for i, j, _ in sorted(taken):
        if j > anchors[-1][1]:
            anchors.append((i, j))
    anchors.append((na, nb))
    used_a = {i for i, _, _ in taken}
    used_b = {j for _, j, _ in taken}
    out: List[Pair] = []
    for (i0, j0), (i1, j1) in zip(anchors, anchors[1:], strict=False):
        run_a = [i for i in range(i0 + 1, i1) if i not in used_a]
        run_b = [j for j in range(j0 + 1, j1) if j not in used_b]
        last_j = -1
        for i in run_a:
            if not run_b:
                break
            j = max(run_b, key=lambda j, i=i: scores[i][j])
            best_for_j = max(scores[k][j] for k in run_a)
            if scores[i][j] >= GAP_MATCH and scores[i][j] >= best_for_j and j > last_j:
                out.append((i, j, scores[i][j]))
                last_j = j
    return out


def _lists() -> Dict[str, List]:
    return {"same": [], "differs": [], "only_a": [], "only_b": []}


def diff(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Dict[str, List]]:
    """Where two Work Maps of one task agree, differ, and where only one expert did something."""
    steps_a, steps_b = list(a.get("steps") or []), list(b.get("steps") or [])
    guards_a, guards_b = list(a.get("guardrails") or []), list(b.get("guardrails") or [])
    sid_a, sid_b = _ids(steps_a, "s"), _ids(steps_b, "s")
    gid_a, gid_b = _ids(guards_a, "g"), _ids(guards_b, "g")

    step_pairs = _match(
        [_step_text(s) for s in steps_a],
        [_step_text(s) for s in steps_b],
        STEP_MATCH,
    )

    def kind_differs(i: int, j: int) -> int:
        return int((guards_a[i].get("kind") or "") != (guards_b[j].get("kind") or ""))

    guard_pairs = _match(
        [_rule_text(g) for g in guards_a],
        [_rule_text(g) for g in guards_b],
        RULE_MATCH,
        kind_differs,
    )
    # Which id on b's side each of a's ids stands for, once matched.
    step_to_b = {sid_a[i]: sid_b[j] for i, j, _ in step_pairs}
    guard_to_b = {gid_a[i]: gid_b[j] for i, j, _ in guard_pairs}

    def attached(guards: List[Dict[str, Any]], ids: List[str], step_id: str) -> List[str]:
        return [gid for g, gid in zip(guards, ids, strict=True) if (g.get("step") or "") == step_id]

    out = {"steps": _lists(), "guardrails": _lists()}

    # Steps.
    for i, j, score in step_pairs:
        sa, sb = steps_a[i], steps_b[j]
        fields = [
            _field(name, sa.get(name), sb.get(name), _says_same) for name in ("decision", "reason")
        ]
        ja, jb = sa.get("judgment"), sb.get("judgment")
        fields.append(_field("judgment", ja, jb, lambda x, y: bool(x) == bool(y)))
        on_a = attached(guards_a, gid_a, sid_a[i])
        on_b = attached(guards_b, gid_b, sid_b[j])
        fields.append(
            _field(
                "guardrails",
                on_a or None,
                on_b or None,
                lambda x, y: {guard_to_b.get(g, f"a:{g}") for g in x} == set(y),
            )
        )
        _place(out["steps"], fields, sid_a[i], sid_b[j], _title(sa), _title(sb), score, sa, sb)
    _only(out["steps"], steps_a, sid_a, step_pairs, 0, _title)
    _only(out["steps"], steps_b, sid_b, step_pairs, 1, _title)

    # Guardrails.
    for i, j, score in guard_pairs:
        ga, gb = guards_a[i], guards_b[j]
        fields = [
            # A reworded rule is the same rule; only a flipped one ("never" vs "always") differs.
            _field(
                "rule", ga.get("rule"), gb.get("rule"), lambda x, y: _polarity(x) == _polarity(y)
            ),
            _field("kind", ga.get("kind"), gb.get("kind"), lambda x, y: x == y),
            _field("ask_whom", ga.get("ask_whom"), gb.get("ask_whom"), _says_same),
            _field(
                "applies_when",
                ga.get("applies_when"),
                gb.get("applies_when"),
                lambda x, y: _says_same(x, y, keep_numbers=False),
            ),
            _field(
                "numbers",
                numbers(ga.get("rule"), ga.get("applies_when")) or None,
                numbers(gb.get("rule"), gb.get("applies_when")) or None,
                lambda x, y: x == y,
            ),
            _field(
                "step",
                ga.get("step"),
                gb.get("step"),
                lambda x, y: step_to_b.get(str(x)) == str(y),
            ),
        ]
        rule_a, rule_b = str(ga.get("rule") or ""), str(gb.get("rule") or "")
        _place(out["guardrails"], fields, gid_a[i], gid_b[j], rule_a, rule_b, score, ga, gb)
    _only(out["guardrails"], guards_a, gid_a, guard_pairs, 0, lambda g: str(g.get("rule") or ""))
    _only(out["guardrails"], guards_b, gid_b, guard_pairs, 1, lambda g: str(g.get("rule") or ""))
    return out


def _place(
    lists: Dict[str, List],
    fields: List[Optional[Dict]],
    id_a: str,
    id_b: str,
    title_a: str,
    title_b: str,
    score: float,
    item_a: Dict[str, Any],
    item_b: Dict[str, Any],
) -> None:
    """A matched pair goes to "same", or to "differs" with the fields that differ."""
    differing = [f for f in fields if f]
    if not differing:
        lists["same"].append({"a": id_a, "b": id_b, "title": title_a or title_b, "score": score})
        return
    lists["differs"].append(
        {
            "a": id_a,
            "b": id_b,
            "title_a": title_a,
            "title_b": title_b,
            "score": score,
            "fields": differing,
            "words_a": _words_of(item_a),
            "words_b": _words_of(item_b),
        }
    )


def _only(
    lists: Dict[str, List],
    items: List[Dict[str, Any]],
    ids: List[str],
    pairs: List[Pair],
    side: int,
    title: Callable[[Dict[str, Any]], str],
) -> None:
    paired = {pair[side] for pair in pairs}
    key = "only_a" if side == 0 else "only_b"
    for k, item in enumerate(items):
        if k not in paired:
            lists[key].append({"id": ids[k], "title": title(item), "words": _words_of(item)})
