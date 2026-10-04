## implementer-1

## B-36 + B-39 · Questions in the diff response; clearer question wording · implementer-1 · in progress
Base: a2208c3 (`git rev-parse --short HEAD` in your worktree must match). Repo /Users/mithra/.builds/sia (you work in your own worktree of it). Gate: `/Users/mithra/.builds/sia/.claude/check.sh a2208c3`.
Goal: (B-36) `GET /api/v1/work_map_diff` also returns, for each expert, the ranked questions to ask them about where their Work Maps differ, so the compare view (built in parallel by implementer-2) can show them. (B-39) those questions read better aloud: only the numbers that actually differ, a short clause when a second hard field differs too, and the rules and steps named instead of "2 rules"/"a different step".
Brief says: Stretch, "Two experts, one task: show where two sessions differ and ask each expert why" (docs/CHALLENGE.md; docs/PROGRESS.md rows S-01, B-36, B-39).
Background (core/backend): `src/router/work_map_diff_router.py` (49 lines) serves `GET /api/v1/work_map_diff?a=&b=` with plain `def get_work_map_diff(a: str, b: str)`: `_uuid` (non-UUID → 404 "Work Map not found"), a == b → 422 "Pick two different Work Maps", `work_map_store.get` per side (None → 404 "Work Map a not found"/"Work Map b not found", a checked first; exception → `_store_unavailable(e)` → 503 "Work Map storage is unavailable"), returns `{"a": _header(...), "b": _header(...), "diff": work_map_diff.diff(map_a, map_b)}`. `src/services/diff_questions.py` has `questions(d, limit=5) -> {"a": [Question], "b": [Question]}` (pure, deterministic; read its module docstring, `PRIORITY`, `TEMPLATES`, `_say`, `_field_question`, `_differs`, `_only`). tests/test_work_map_diff_router.py (11 tests, `client` fixture with the store monkeypatched, maps MAP_A/MAP_B: two experts coding a supplier invoice, capex threshold 5,000 vs 10,000, a vendor-list step only B has) and tests/test_diff_questions.py (14 tests) are the existing tests. On those fixtures today, A's top question reads "On "Equipment over 5,000 goes to capex account 0400", you went with 0400 and 5,000; in another session it was 0400 and 10,000. Which holds, and when?": the shared account code 0400 is noise.
Owns: core/backend/src/router/work_map_diff_router.py, core/backend/tests/test_work_map_diff_router.py, core/backend/src/services/diff_questions.py, core/backend/tests/test_diff_questions.py.
Must not touch: core/backend/src/services/work_map_diff.py and tests/test_work_map_diff.py (read only; report bugs, don't fix), core/backend/main.py, src/router/path_router.py, other routers, storage/*, tests/conftest.py, pyproject.toml, uv.lock, everything under pixel-perfect-capture/ (implementer-2 and implementer-3), .claude/check.sh.
Plan:
1. (B-36, do first) router: add `limit: int = Query(5, ge=0, le=10)` (from fastapi) to `get_work_map_diff`; compute `d = work_map_diff.diff(...)` once and return `{"a", "b", "diff": d, "questions": diff_questions.questions(d, limit)}` (no second diff; key order as in the Contract). Validation order unchanged (a FastAPI 422 for a bad `limit` comes before any store call; that is fine). Update the endpoint docstring.
2. (B-36) tests in test_work_map_diff_router.py: `questions` present with keys exactly `a` and `b`, each a list of objects with exactly the Question keys; A's questions carry A's item ids and quote only A's words (and B's only B's), e.g. B's list has the `only` question for the vendor-list step with B's quote; the default caps at 5; `limit=1` gives at most one per side; `limit=0` gives `{"a": [], "b": []}` with the diff still present; `limit=11`, `limit=-1` and `limit=abc` → 422; swapping a and b swaps the two lists (same ids); a map with no steps still returns questions (possibly empty lists). Don't assert full question texts in the router tests (that's test_diff_questions' job), so wording changes don't ripple.
3. (B-39) numbers: in the `numbers` template say only the numbers that differ (drop those both sides share, so "you went with 5,000; in another session it was 10,000"); if nothing is left on a side, fall back to that side's full list, and the existing empty-side templates still apply when a side really has none.
4. (B-39) second-field clause: in `_differs`, after choosing the pair's top field, if the next field by priority is one of `numbers`, `rule`, `kind`, `ask_whom`, `judgment` (never reworded text, never `missing_*` text fields) and has a value on at least one side, append exactly one short sentence after the question, e.g. "The numbers differ too." / "The rule reads the other way too." / "The kind of rule differs too." / "The person to ask differs too." / "Whether it's a judgment call differs too." (a dict `ALSO` next to `TEMPLATES`). At most one clause; ids, `field` (still the top field) and ranking unchanged.
5. (B-39) name the rules and steps: in `questions()`, build once per side a label lookup from the diff itself: guardrail id → rule (`same[].a/b` + `title`, `differs[].a/b` + `title_a`/`title_b`, `only_a`/`only_b` `id` + `title`) and step id → title the same way from `steps`; pass it down. The step-level `guardrails` field (a/b = lists of guardrail ids) names the rules in quotes, each trimmed to ~50 chars with `trim`, at most two, then "and N more" (`"Equipment over 5,000 goes to capex" and "Never pay an unlisted vendor"`); ids with no label count toward "N more"/fall back to today's "one rule"/"N rules" when none has a label. The guardrail-level `step` field (a/b = step ids) names each side's step title ("You tied this rule to "Code the cost account"; in another session it came in at "Approve the invoice for payment". Where does it come in, and why?"), falling back to today's wording when a title is missing. Update the module docstring to say so.
6. Tests in test_diff_questions.py: numbers drops the shared 0400; the second-field clause appears for numbers + ask_whom, not for numbers + reworded decision, and only once with three hard fields; rules named (two names, and "and 1 more" with three) and unnamed ids fall back; step names on a `step` field, and fallback without titles; ids and order of the existing end-to-end test unchanged. Change existing exact-text assertions only where these clauses apply.
7. Ruff-clean (line length 100) and ruff-formatted on all four files; type hints and short comments like the code around it.
Done when: `cd core/backend && uv run --extra dev pytest -q` passes (only the known privacy-extra skip, 0 xfailed); `uvx ruff check` and `uvx ruff format --check` on the four files are clean; `/Users/mithra/.builds/sia/.claude/check.sh a2208c3` prints ALL CHECKS PASSED. Report test counts, the questions for both sides on MAP_A/MAP_B (`curl`-shaped JSON of `questions`), and the `ALSO` sentences.
Contract (implementer-2 builds the compare view against this in parallel; implement exactly):
```
GET /api/v1/work_map_diff?a=<work map uuid>&b=<work map uuid>[&limit=<int 0..10, default 5>]
200 {
  "a": {"id": str, "task": str | null, "recorded_at": str | null, "confirmed": bool,
        "status": str, "steps": int, "guardrails": int},
  "b": { same shape },
  "diff": Diff,
  "questions": {"a": [Question], "b": [Question]}   # diff_questions.questions(diff, limit):
                                                    # ranked best first, at most `limit` each,
                                                    # [] when nothing differs or limit=0
}
404 {"detail": "Work Map a not found" | "Work Map b not found" | "Work Map not found" (a or b not a UUID)}
422 {"detail": "Pick two different Work Maps"} when a == b (also the same UUID in another case)
422 {"detail": [ {...FastAPI validation error...}, ... ]} (a list) when a or b is missing or limit is
    not an int in 0..10
503 {"detail": "Work Map storage is unavailable"}

Diff = {
  "steps": {
    "same":    [{"a": id, "b": id, "title": str, "score": float}],
    "differs": [{"a": id, "b": id, "title_a": str, "title_b": str, "score": float,
                 "fields": [{"field": str, "kind": "changed" | "missing_a" | "missing_b",
                             "a": value | null, "b": value | null}],
                 "words_a": {"quote": str, "quote_translation": str, "reason": str},
                 "words_b": {"quote": str, "quote_translation": str, "reason": str}}],
    "only_a":  [{"id": id, "title": str, "words": {"quote": str, "quote_translation": str, "reason": str}}],
    "only_b":  [same shape as only_a]
  },
  "guardrails": { the same four lists; "title"/"title_a"/"title_b" are the rule texts }
}
Step fields: "decision", "reason" (a/b strings), "judgment" (a/b booleans or null),
  "guardrails" (a/b lists of that side's guardrail ids, or null).
Guardrail fields: "rule" (a/b rule texts; only when polarity words differ: never/always,
  over/under...), "kind" (a/b "limit" | "exception" | "stop_and_ask"), "ask_whom", "applies_when"
  (strings), "numbers" (a/b sorted lists of number strings, e.g. ["0400", "5000"]), "step" (a/b step ids).
Ids (id) are strings: the map's own ids or the s<n>/g<n> fallbacks. `words` values are strings,
  never null; quote/quote_translation are "" when the expert's words were narration.

Question = {
  "id": str,        # e.g. "guardrails:g1:g1:numbers", "steps:-:s2:only"; the same on both
                    # sides of one difference (pair the two sides by it)
  "section": "steps" | "guardrails",
  "item": str,      # the asked expert's own item id (matches diff ids of that side)
  "other": str | null,   # the matching item id in the other map; null for only-one-expert items
  "field": str,     # the diff field asked about, or "only"
  "text": str,      # the question as the apprentice would say it (English)
  "quote": str      # the asked expert's words it quotes, "" if none
}
```
