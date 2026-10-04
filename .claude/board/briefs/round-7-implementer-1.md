## implementer-1

## B-37 · Keep a chosen question for an expert's next session · implementer-1 · in progress
Base: f26ade7 (`git rev-parse --short HEAD` in your worktree must match). Repo /Users/mithra/.builds/sia (you work in your own worktree of it). Gate: `/Users/mithra/.builds/sia/.claude/check.sh f26ade7` must print ALL CHECKS PASSED.
Goal: a question from the compare page ("Ask the expert of Session A ...") can be stored on that expert's Work Map, listed, and withdrawn, so that their next session can ask it (B-38, next round) and the compare page can offer an "Ask in their next session" button (B-40, next round). Backend only this round.
Brief says: Stretch, "Two experts, one task: show where two sessions differ and ask each expert why" (docs/CHALLENGE.md). The difference is shown today; nothing stores a question, so nobody is ever asked. This is the first of three steps (B-37 store → B-38 asked in the next debrief → B-40 the button).
Background (core/backend):
- A session's row in `work_maps` is its Work Map (same UUID). The row has a jsonb `captures` list that holds what the agent recorded live: `{"kind": "step" | "guardrail" | ... }` from `POST /api/v1/sessions/{id}/capture` (`src/router/path_router.py` `add_capture`, ~line 160, stores `redact_deep(payload)` as is), `{"kind": "live_question", "text", "t", "question_kind", "phase", "deferred"?}` (`add_live_question`), and `{"kind": "correction", "correction", "quote", "t", "phase"}` (`edit_work_map`, ~line 314). `storage/work_maps.py` `add_capture(session_id, capture) -> bool` appends one capture (`captures || [capture]`, False if no such row) and `get(id)` returns the whole row (dict with "captures").
- Who reads captures: `merge_session` (`path_router.py` ~line 230) passes them to the LLM merge (`src/services/work_map_merge.py` `merge(..., captures=...)`, which dumps them into the prompt as `CAPTURES:` JSON, line ~190) after dropping only `live_question`; line ~242 builds `corrections` from `kind == "correction"`; `get_work_map` (~line 348) pops `captures` and returns only `live_questions.from_captures(...)` (keeps `kind == "live_question"` only); `storage/work_maps.py` `defer_live_question` only touches `live_question`. Nothing else reads captures (check with `grep -rn captures src storage`).
- Router patterns to copy: `src/router/work_map_diff_router.py` (its own `APIRouter(prefix="/api/v1")`, imports `_store_unavailable` and `_uuid` from `path_router`, plain `def` endpoints because psycopg blocks), registered in `main.py` with `app.include_router(work_map_diff_router.router)`. Tests: `tests/test_work_map_diff_router.py` and `tests/test_router.py` (a `FakeStores` with `add_capture`/`get`, monkeypatched onto `path_router.work_map_store`, a `TestClient` on a bare `FastAPI()`). `tests/conftest.py` puts the backend on sys.path and sets placeholder keys: do not edit it.
- Redaction: `src/services/privacy.py` `redact(text) -> str` (regex for emails/IBANs/phones etc. always; Presidio names when the privacy extra is installed). Everything stored from a user must go through it.
- Question ids come from `src/services/diff_questions.py` and look like `"guardrails:g1:g1:numbers"` or `"steps:-:s2:only"`: they contain `:` and could in theory contain other characters, so never put one in a URL path segment.
Owns: core/backend/src/services/follow_ups.py (new), core/backend/src/router/follow_ups_router.py (new), core/backend/main.py (one import + one `include_router` line), core/backend/src/router/path_router.py (only the merge capture filter and the reserved-kind check in `add_capture`, see Plan 4-5), core/backend/tests/test_follow_ups.py (new).
Must not touch: tests/conftest.py, tests/test_router.py, storage/ (no migration: everything lives in the existing `captures` column), src/services/work_map_merge.py, src/services/diff_questions.py, src/services/apprentice_agent.py and any agent prompt, src/router/work_map_diff_router.py, everything under pixel-perfect-capture/ (implementers 2 and 3), pyproject.toml, uv.lock.
Plan:
1. `src/services/follow_ups.py` (pure, no I/O). Capture kinds, as module constants:
   - `QUESTION = "follow_up_question"`: `{"kind": "follow_up_question", "question_id": str, "text": str, "quote": str, "from": str, "added_at": str}`. `text`/`quote` already redacted; `quote` is `""` when there is none; `from` is the UUID (lowercase canonical form) of the other Work Map the question came out of; `added_at` is UTC ISO 8601 (`datetime.now(timezone.utc).isoformat(timespec="seconds")`).
   - `WITHDRAWN = "follow_up_withdrawn"`: `{"kind": "follow_up_withdrawn", "question_id": str, "at": str}`.
   - `DELIVERED = "follow_up_delivered"`: `{"kind": "follow_up_delivered", "question_id": str, "at": str, "session": str}` (written by B-38 when the next session's final merge has asked it; define the constant and handle it in `pending` now).
   - `PARENT = "parent"`: `{"kind": "parent", "work_map_id": str}` (written by B-38 on a repeat session; constant only).
   - `NOT_FOR_MERGE = frozenset({"live_question", QUESTION, WITHDRAWN, DELIVERED, PARENT})`.
   Functions: `capture(question: dict, from_id: str, now: datetime) -> dict` builds a QUESTION capture from an already validated and redacted `{"id", "text", "quote"}`; `closed(question_id, kind, now, session=None) -> dict` builds WITHDRAWN/DELIVERED; `pending(captures) -> list[dict]` walks the captures in order (ignore non-dicts and other kinds): a QUESTION makes its `question_id` pending unless it already is (first one wins, so a double post from a race is harmless), WITHDRAWN or DELIVERED removes it; a question added again after being withdrawn is pending again with its new `added_at`. Returns `[{"question_id", "text", "quote", "from", "added_at"}]`, oldest first (a re-added question counts from its new add). `for_merge(captures) -> list[dict]` = the dict captures whose kind is not in `NOT_FOR_MERGE`.
2. `src/router/follow_ups_router.py`, `APIRouter(prefix="/api/v1", tags=["Follow-up questions"])`, plain `def` endpoints, store errors through `_store_unavailable`, `{work_map_id}` through `_uuid(work_map_id, "Work Map")` (404 "Work Map not found" for a non-UUID), then `work_map_store.get` → 404 "Work Map not found" when None. Body models with pydantic (`BaseModel`, `Field`) so a bad shape is FastAPI's own 422 (list `detail`):
   - `FollowUpIn {id: str (1..200 chars), text: str (1..300), quote: str = "" (0..300), from_work_map_id: str}`; body `{questions: list[FollowUpIn] (1..10 items)}`. Strip `text`/`quote`; a text empty after stripping → 422 `"A question needs its text"`. `from_work_map_id` not a UUID → 422 `"from_work_map_id is not a Work Map id"`; equal to the path id (compare canonical UUIDs) → 422 `"A question can't come from the same Work Map"`. The source map does not have to exist any more.
   - Redact `text` and `quote` with `privacy.redact` after the length check, before storing.
   - `POST /api/v1/work_maps/{work_map_id}/follow_up_questions`: read the row, compute `pending(captures)`, and append one QUESTION capture per question whose `id` is neither pending nor earlier in the same body (`work_map_store.add_capture`, one call each; if it returns False the row vanished → 404). Response 200 below.
   - `GET /api/v1/work_maps/{work_map_id}/follow_up_questions` → 200 `{"questions": pending(captures)}`.
   - `DELETE /api/v1/work_maps/{work_map_id}/follow_up_questions?question_id=<id>` (query parameter, required, 1..200 chars): 404 `"No such question waiting"` when it isn't pending; else append a WITHDRAWN capture (never rewrite the list) and return 200 `{"withdrawn": question_id, "questions": [...pending after]}`.
3. `main.py`: `from src.router import follow_ups_router` and `app.include_router(follow_ups_router.router)` next to the other two.
4. `path_router.merge_session`: replace the inline filter with `captures=follow_ups.for_merge(session.get("captures") or [])` and keep the comment, extended: live questions are the apprentice's and follow-up questions belong to the expert's next session, so neither is what the apprentice learned. The `corrections=` line stays as it is.
5. `path_router.add_capture` (the generic agent capture endpoint): reject a payload whose `kind` is one of `QUESTION`, `WITHDRAWN`, `DELIVERED`, `PARENT` with 422 `"That kind of capture can't be recorded here"`, before touching the store, so a client tool can't forge them.
6. Tests in `tests/test_follow_ups.py` (fake the store in the test file: a small in-memory `get`/`add_capture` monkeypatched onto `storage.work_maps` as imported by the router; a `TestClient` on a bare `FastAPI()` with `follow_ups_router.router` and, for the merge test, `path_router.router`):
   - helpers: `pending` order, first-wins dedupe, withdraw, delivered, re-add after withdraw, non-dict and other kinds ignored; `for_merge` drops exactly the five kinds.
   - POST: stores the exact capture shape (assert keys and that `from` is canonical), dedupe against pending and within one body (`added` lists only the new ids), redaction (an email and an IBAN in `text`/`quote` don't reach the store), 404 unknown/non-UUID map, 422 for 0 or 11 questions, text > 300 chars, blank text, bad `from_work_map_id`, same map; 503 when the store raises.
   - GET/DELETE: list after posts, withdraw then list, DELETE of an unknown or already withdrawn id → 404, ids with `:` round-trip through the query string.
   - Merge: put a `follow_up_question`, a `parent` and a `live_question` capture plus a `step` capture on a session, monkeypatch `path_router.merge` with an async fake that records its `captures` argument (and `work_map_store.screen_events`/`save_map` with fakes), call `POST /api/v1/sessions/{id}/merge` and assert only the `step` capture reached the merge.
   - `POST /api/v1/sessions/{id}/capture` with `{"kind": "follow_up_question", ...}` → 422 and no store call.
Done when: `cd core/backend && uv run --extra dev pytest -q` passes (only the known privacy-extra skip); `uvx ruff check` and `uvx ruff format --check` on the new/changed files are clean; `/Users/mithra/.builds/sia/.claude/check.sh f26ade7` prints ALL CHECKS PASSED. Report the test count and a `curl`-shaped example of each endpoint's response.
Contract (B-38 and B-40 are built against this next round; implement exactly):
```
POST /api/v1/work_maps/{id}/follow_up_questions
  body {"questions": [{"id": str (1..200), "text": str (1..300), "quote": str (0..300, default ""),
                       "from_work_map_id": str (UUID, != id)}]}   # 1..10 items
  200 {"added": [question_id, ...],        # only the newly stored ones, in body order
       "questions": [FollowUp, ...]}        # everything pending after the post
GET /api/v1/work_maps/{id}/follow_up_questions
  200 {"questions": [FollowUp, ...]}        # pending, oldest first; [] when none
DELETE /api/v1/work_maps/{id}/follow_up_questions?question_id=<id>
  200 {"withdrawn": question_id, "questions": [FollowUp, ...]}
  404 {"detail": "No such question waiting"}
All three: 404 {"detail": "Work Map not found"} (unknown or not a UUID);
  503 {"detail": "Work Map storage is unavailable"};
  422 {"detail": str} for "A question needs its text" | "from_work_map_id is not a Work Map id" |
      "A question can't come from the same Work Map"; 422 {"detail": [...]} (list) for a bad shape.
FollowUp = {"question_id": str, "text": str, "quote": str, "from": str, "added_at": str}
  # question_id = diff_questions' Question.id; from = the other Work Map's UUID

Captures on the asked expert's Work Map row (work_maps.captures, appended, never rewritten):
  {"kind": "follow_up_question", "question_id", "text", "quote", "from", "added_at"}
  {"kind": "follow_up_withdrawn", "question_id", "at"}
  {"kind": "follow_up_delivered", "question_id", "at", "session"}   # B-38 writes these
  {"kind": "parent", "work_map_id"}                                 # B-38 writes this on a repeat session
follow_ups.pending(captures) and follow_ups.for_merge(captures) are the only readers.
```
