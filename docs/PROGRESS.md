# Progress against the brief

2026-10-04 · `8ce6cf4` (build/2026-10-04) · **Required** 27 Built, 0 Partial, 0 Missing · **Stretch** 4 Built, 3 Partial, 2 Missing · **Moonshot** 0 Built, 0 Partial, 4 Missing · **Beyond** 0 Built, 4 Partial, 10 Missing

Yardstick: `docs/CHALLENGE.md`. Paths are relative to the repo root; `ui/` = `pixel-perfect-capture/src/`, `be/` = `core/backend/`.
Built means the code path exists end to end. Nothing here was run against ElevenLabs, OpenAI or Supabase: the live voice loop is only checked by reading the code.

## Required

| ID | Feature | Status | Evidence | What's left |
|---|---|---|---|---|
| R-01 | Web app where the expert shares their screen; the agent listens in a side panel (the pill) | Built | `ui/components/Sia.tsx:55-57`, `ui/routes/pill.tsx`, `pixel-perfect-capture/electron/main.cjs:103` | |
| R-02 | A frame every 1–2 s goes to a vision model and comes back as events | Built | `ui/hooks/use-screen-events.ts:6,174`, `be/src/router/path_router.py:53-100`, `be/src/services/screen_vision.py:133,164` | |
| R-03 | Screen events reach the ElevenAgents conversation (client side) | Built | `ui/hooks/use-apprentice.ts:726-731` (`[SCREEN mm:ss]` contextual updates) | |
| R-04 | Stays quiet while the expert types, reads or talks; asks only at natural pauses | Built | `ui/lib/floor.ts:63-80`, `ui/lib/floor.test.ts:18`, `ui/hooks/use-apprentice.ts:759-810` (`[PAUSE]`, muted replies → `[NOT HEARD]` at 239-244) | |
| R-05 | ≥3 live questions, each about something on screen, ≥1 about a guardrail (checked in code) | Built | `ui/hooks/use-apprentice.ts:108-110,259-290,655-686`, `be/src/services/live_questions.py:37`, `be/src/router/path_router.py:161-181` | |
| R-06 | Spoken debrief after the task, driven by a draft Work Map and its gaps | Built | `ui/hooks/use-apprentice.ts:396-404`, `be/src/services/work_map_merge.py:55,165-230`, `be/src/router/path_router.py:197-245` | |
| R-07 | Debrief asks ≥3 follow-ups that were not answered during the task | Built | Counted in code: debrief questions tallied at `ui/hooks/use-apprentice.ts:635` (any script's question mark, check-ins and `[SKIP]`ped ones not counted, 814), `start_teach_back` refused with the open gaps until 3 are asked (426-449, `[NOT YET]` message since the agent doesn't wait); `debriefStatus`/`isDebriefQuestion` in `ui/lib/floor.ts:183,231` with vitest; pill shows "Debrief n/3" `ui/components/Sia.tsx:173`. Liveness valve lets it through after 3 refusals (`floor.ts:157`) | |
| R-08 | Ends with a teach-back the expert confirms; corrections recorded | Built | `confirm_work_map` refuses until a teach-back of ≥25 words (Intl.Segmenter) was spoken and the expert answered yes; a no/correction (EN/DE) is never overridden: `ui/hooks/use-apprentice.ts:461-495`, `ui/lib/floor.ts:254`; confirmation sent and redacted `be/src/router/path_router.py:244-261`, stored `be/storage/work_maps.py:114-160`, shown "Confirmed by the expert at mm:ss" `ui/components/WorkMap.tsx:505-517`. Storing it needs migration 005 (*Needs the user*); without it the gate still works and the map saves without the quote. Re-asking in the teach-back is detected by ASCII `?` only (`use-apprentice.ts:642`); the expert's latest answer is what counts | |
| R-09 | Work Map: clickable timeline; each step has screen moment, decision, reason in the expert's words, guardrails | Built | `ui/components/WorkMap.tsx:234-900` (thumbs, clips 876, quotes + translation 675-742, "Asked while working" 750), `be/src/router/path_router.py:312-354` | |
| R-10 | Every step and guardrail links to a screen moment and the expert's own words | Built | Grounding and snapping as before (`be/src/services/work_map_links.py:141-243`); every still-unlinked item becomes a question (`work_map_links.py:267-290`), asked first in the debrief draft and kept in the confirmed map's open questions (`be/src/services/work_map_merge.py:223-225`); `be/tests/test_work_map_links.py`, `test_work_map_merge.py` | |
| R-11 | Tutor built from the Work Map watches the new hire's screen | Built | `be/src/router/path_router.py:418-444`, `be/src/services/tutor.py:36-71`, `ui/components/Tutor.tsx:83-88`, `ui/hooks/use-tutor.ts:214-250` | |
| R-12 | Tutor explains each step the way the expert did | Built | `be/src/services/apprentice_agent.py:227-256` (`[DONE]`, expert's words), `ui/hooks/use-tutor.ts:424` | |
| R-13 | Tutor asks the new hire to predict the next decision | Built | `be/src/services/tutor.py:90` (`next_step`), `ui/hooks/use-tutor.ts:419`, `record_prediction` 171-180 | |
| R-14 | Tutor catches a wrong decision **before it is saved** and explains it with the expert's reasoning | Built | Pill publishes watching/checked/hold on `BroadcastChannel("tacit-tutor")` (`ui/hooks/use-tutor.ts:154-171,416,496-508`, `ui/lib/tutor-hold.ts`); the practice ERP locks Post/Hold/Send with "The tutor wants a word first" and its confirm waits ("Checking with the tutor…", ≤8 s, frame-lag margin 500 ms) for a check of the open dialog (`ui/routes/sandbox.tsx:98-110,287,451-465,573-583`, `decideConfirm` `ui/lib/tutor-hold.ts:109`); 18 vitest cases; `docs/DEMO.md:56`. Pill and ERP must be same-origin windows (true in Electron and one browser) | |
| R-15 | Replays the expert's screen moment when it helps | Built | `ui/hooks/use-tutor.ts:163-170`, `ui/components/Tutor.tsx:263`, `ui/components/ClipPlayer.tsx`, `be/src/router/path_router.py:369-383` | |
| R-16 | Shows what the new hire mastered and what to practice next | Built | `be/src/services/tutor.py:146-187` (computed, not LLM), `ui/components/Tutor.tsx:286-330` | |
| R-17 | A case the expert never showed (judge as new hire) | Built | `ui/lib/sandbox.ts:161-205` (4480 €7,200 equipment pre-coded opex, 4481–4483) | |
| R-18 | Apprentice Test 1, when to ask | Built | Same as R-04; `docs/PITCH.md` slide 3 | |
| R-19 | Apprentice Test 2, what to ask | Built | `be/src/services/apprentice_agent.py:46-53`, `[PAUSE]` carries the last screen events `ui/hooks/use-apprentice.ts:798-810`, labels `be/src/services/live_questions.py:19-23` | |
| R-20 | Apprentice Test 3, when it has understood (debrief done + teach-back proves it) | Built | Checked in code, not left to the LLM: R-07 and R-08 gates | |
| R-21 | Apprentice Test 4, whether the new hire learned | Built | R-14 to R-17; report from attempts `be/src/router/path_router.py:483-511` | |
| R-22 | Apprentice Test 5, trust: off the record + personal data on screen protected | Built | Off the record: `ui/components/Sia.tsx:55-57,112-113`, `ui/hooks/use-apprentice.ts:623-636,729`; shield (on-device OCR, fails closed) `ui/hooks/use-privacy-shield.ts:40-45`, `ui/lib/pii.ts`; text redaction `be/src/services/privacy.py:60-85`; pill hidden from capture `electron/main.cjs:103`; delete + 30-day purge `be/main.py:51-72`, `be/src/router/path_router.py:386-397` | |
| R-23 | ElevenAgents plays both roles, Expressive Mode | Built | `be/src/services/apprentice_agent.py:288-388` (`expressive_mode` 334), `sync()` 472-495 | Live sync not verified this run. |
| R-24 | Choice of LLM behind the agent | Built | `be/src/services/apprentice_agent.py:357` (`APPRENTICE_LLM`, default gpt-4.1) | |
| R-25 | Scribe v2 Realtime listens; patient turn-taking | Built | `be/src/services/apprentice_agent.py:320-329` | |
| R-26 | Moonshot slide in the pitch, with the path from the MVP | Built | `docs/PITCH.md:88-100` | |
| R-27 | Default workflow: three supplier invoices in a sandbox ERP with hidden judgment calls | Built | `ui/lib/sandbox.ts:106-160`, `ui/routes/sandbox.tsx` | |

## Stretch

| ID | Feature | Status | Evidence | What's left |
|---|---|---|---|---|
| S-01 | Two experts, one task: show where two sessions differ and ask each expert why | Missing | Nothing compares maps | Backend first: `be/src/services/work_map_diff.py` aligns two confirmed maps (LLM matches steps/guardrails by meaning; deterministic pairing of values) and returns `{same, differs:[{a,b,question_for_a,question_for_b}], only_a, only_b}`; `GET /api/v1/work_maps/diff?a=&b=`; pytest with OpenAI mocked. UI is B-10. |
| S-02 | Any language: expert in German, tutor teaches in English | Built | `be/src/services/languages.py:93`, `be/src/services/work_map_merge.py:50,211`, `ui/lib/languages.ts`, `ui/hooks/use-tutor.ts:246-247` | |
| S-03 | Agent-ready guardrails: export the map as instructions an agent can load | Partial | Only a raw JSON download: `ui/components/WorkMap.tsx:415-426` | `be/src/services/agent_export.py` renders a confirmed map as agent instructions (Markdown system prompt: steps in order, decision rules, each guardrail as a hard "STOP and ask <whom> when …", the expert's words) plus a JSON tool-friendly form; `GET /api/v1/work_maps/{id}/agent.md` and `/agent.json`; an "Export for agents" item next to Export JSON; pytest on a fixture map. |
| S-04 | Presidio redacts personal data in transcripts | Partial | Optional import, not a dependency: `be/src/services/privacy.py:9-11,46-57`; not in `be/pyproject.toml` | Add `presidio-analyzer` and an `en_core_web_sm` model as an optional `privacy` extra in `pyproject.toml`, keep the regex fallback, add pytest for `redact()` with and without Presidio (skip if not installed), and report in `/health` whether name redaction is active. |
| S-05 | Tutor looks up guardrails through an MCP server | Missing | No MCP code; `mcp` not in `be/uv.lock` | `be/src/mcp_server.py` (Python `mcp` SDK, streamable HTTP mounted on FastAPI) with tools `list_work_maps`, `get_guardrails(work_map_id, query)`, `check_action(work_map_id, action)` reusing `tutor.work_map_text`; pytest via the SDK's in-memory client. Registering it on the ElevenLabs tutor is in *Needs the user*. |
| S-06 | Work Map goes into the tutor's knowledge base and Procedures | Partial | The map is injected as a prompt dynamic variable, not a knowledge base: `be/src/services/apprentice_agent.py:235,491`, `be/src/router/path_router.py:441` | Build the knowledge-base document and per-step Procedure payloads from a map (`be/src/services/tutor_kb.py`, pure functions + pytest) and an endpoint that returns them; pushing them to ElevenLabs is in *Needs the user*. |
| S-07 | Replay the expert's moment | Built | `be/src/services/recordings.py:94-200`, `ui/components/ClipPlayer.tsx`, `ui/components/WorkMap.tsx:876` | |
| S-08 | Predict the next decision | Built | Same as R-13 | |
| S-09 | Mastery report | Built | Same as R-16 | |

## Moonshot

| ID | Feature | Status | Evidence | What's left |
|---|---|---|---|---|
| M-01 | A living company memory: repeat sessions merge into one map; the apprentice asks only about what changed | Missing | Each session is its own map (`be/storage/work_maps.py:110`) | First slice: `POST /sessions/{id}/start` accepts `parent_work_map_id` (kept in `captures`, no migration); `be/src/services/work_map_update.py` merges a new session into the parent map, keeps unchanged items with their original moments and quotes, and returns `changed`/`new` items as the only debrief gaps; pytest with OpenAI mocked. UI is B-09. |
| M-02 | The always-on apprentice: notices a case no map covers and asks one question | Missing | Nothing compares live events against all maps | `be/src/services/coverage.py`: given a screen event, find the confirmed maps/steps that cover it (keyword prefilter + one LLM call) and return `covered` or `novel` with one suggested question; `POST /api/v1/coverage/check`; store novel cases as captures on a rolling "inbox" session; pytest with OpenAI mocked. UI is B-11. |
| M-03 | People first, then agents: an agent takes routine steps, people keep the judgment calls | Missing | Nothing acts on the sandbox | After S-03: an "Autopilot" in the practice ERP (`ui/lib/autopilot.ts` + `ui/routes/sandbox.tsx`) that asks `POST /api/v1/work_maps/{id}/decide` (invoice → `routine` with the action, or `judgment` with the guardrail) and posts routine invoices itself, leaving judgment calls in a "For you" queue with the expert's words; vitest on the planner with the endpoint mocked, pytest on `decide`. |
| M-04 | The world's operations manual: anonymized Work Maps across companies | Missing | No anonymization beyond PII redaction | `be/src/services/anonymize.py` strips company, supplier and people names and exact amounts to bands from a confirmed map (deterministic + `privacy.redact`), `GET /api/v1/catalog` lists anonymized maps grouped by task, and a read-only `ui/routes/catalog.tsx`; pytest that no supplier name or exact amount from the source survives. |

## Beyond

| ID | Feature | Status | Evidence | What's left |
|---|---|---|---|---|
| B-01 | Backend test suite (OpenAI, ElevenLabs and Postgres mocked) | Partial | `be/tests/conftest.py` (fake AsyncOpenAI), 24 tests for `work_map_links`, `work_map_merge`, `work_maps` storage; run by `.claude/check.sh` with `uv run --with pytest --with pytest-asyncio`; `pytest` not in `be/pyproject.toml` dev extra | Add `be/tests/test_work_map_edit.py` (`work_map_edit.apply`, `be/src/services/work_map_edit.py:90`), `test_tutor_report.py` (`tutor.report`, `tutor.py:146`), `test_privacy.py` (`privacy.redact`, `privacy.py:60`) and `test_router.py` (FastAPI `TestClient` with the store faked) reusing `conftest.py`; add `pytest` and `pytest-asyncio` to the dev extra. |
| B-02 | Backend lint passes | Partial | `uvx ruff check .` → 300 errors (222 E501, 27 B904, 13 B008, 9 I001, …) | Allow long prompt strings (per-file E501 ignores for prompt modules or `line-length = 120`), fix the rest (`raise … from e`, imports, `l` names), so `ruff check .` exits 0. Touches most backend files: run it alone. |
| B-03 | Search across all Work Maps | Missing | List page only filters confirmed/unconfirmed: `ui/routes/work-maps.index.tsx:76-83` | `GET /api/v1/work_maps/search?q=` over task, step titles, decisions, reasons, guardrail rules and quotes (SQL `ilike` on the jsonb text, ranked), and a search box on the Work Maps page that jumps to the matching step; pytest + vitest. |
| B-04 | Coverage analytics across maps and lessons | Missing | Nothing aggregates | `GET /api/v1/analytics`: per map, steps, judgment calls, guardrails by kind, unlinked items, open questions, lessons run and per-step mastery rate (from `lessons.report`); `ui/routes/analytics.tsx` with plain tables/bars; pytest on the aggregation as a pure function. |
| B-05 | Practice cases made from a map, with spaced repetition | Missing | New-hire cases are hand-written: `ui/lib/sandbox.ts:161-205` | `POST /api/v1/work_maps/{id}/practice_cases` generates sandbox invoices that hit each guardrail's edge (LLM, schema-checked against the `Invoice` type), the sandbox gets a "Generated practice" set, and steps in a lesson's *practice next* come back sooner (`ui/lib/practice-schedule.ts`, Leitner boxes in localStorage); pytest + vitest. |
| B-06 | A second sandbox workflow: insurance claims, with its own judgment calls and guardrails | Missing | Only Ledgerly invoices | `ui/lib/sandbox-claims.ts` (claims with a fraud-pattern repeat claimant, a limit above which an adjuster must approve, a missing police report) and a workflow switch in `ui/routes/sandbox.tsx` (or a sibling route `claims.tsx`); vitest on the data invariants; capture and tutor need no change. |
| B-07 | Settings page works (today it is a mockup: nothing is saved or checked) | Partial | `ui/routes/settings.tsx:420-470` hard-coded "Connected"/healthy rows, no fetch or storage | Persist the real options (language, shortcuts, retention view, capture toggles that already exist in hooks) in `ui/lib/settings.ts` (localStorage), make Diagnostics call `/health` and `/api/v1/agent/token?role=…` reachability, and hide the fake Integrations behind "Coming soon"; vitest on the store. |
| B-08 | Workspaces: each team sees only its own Work Maps | Missing | All maps are global: `be/storage/work_maps.py:133` | Scope by a `workspace` value: store it in the existing `captures`/map JSON (no migration), read it from an `X-Workspace` header (default "default"), filter list/get/search/delete, and add a workspace picker in `AppHeader.tsx`; pytest that one workspace can't read another's map. Real sign-in is in *Needs the user*. |
| B-09 | Living map UI: "Record again to update" and what changed since last time | Missing | | After M-01: a button on the Work Map that starts a session with `parent_work_map_id`, and change badges (new / changed / confirmed again) on steps and guardrails; vitest on the badge logic. |
| B-10 | Two-session diff view with the questions to ask each expert | Missing | | After S-01: `ui/routes/work-maps.compare.tsx` picks two maps and shows side-by-side steps with differences highlighted and each expert's question, with a "Ask in their next debrief" action that stores the question as an `open_question` capture on that expert's map; vitest. |
| B-11 | Novel-case inbox | Missing | | After M-02: the pill calls `/coverage/check` on action events while capturing, and a `ui/routes/inbox.tsx` lists cases no map covers with the suggested question and "start a session about this"; vitest with the endpoint mocked. |
| B-12 | UI lint passes | Partial | `npm run lint` → 133 problems (124 errors, 9 warnings), nearly all `prettier/prettier`; 118 in `ui/components/Sia.tsx`; all errors auto-fixable | Run `npx eslint --fix` on `ui/components/Sia.tsx` and the other flagged files, fix the 9 warnings by hand, so `npm run lint` exits 0 with tests and build still passing. Touches `Sia.tsx`: run with no other pill work in flight. |
| B-13 | Teach-back check against the map: what the apprentice left out | Missing | The R-08 gate checks length and the expert's yes, not content (`ui/lib/floor.ts:254`) | `be/src/services/teach_back_check.py`: given the draft map and the teach-back text, list steps and guardrails it never mentioned (deterministic keyword overlap first, one LLM call for paraphrases) and return them as "You didn't mention X; does it still apply?"; the draft merge stores them so `confirm_work_map` can tell the agent to ask about them once before saving; pytest with OpenAI mocked, vitest on the pill's handling. |
| B-14 | Third sandbox workflow: KYC onboarding review | Missing | Only Ledgerly invoices | After B-06 (reuses its workflow switch): `ui/lib/sandbox-kyc.ts` with customer files that hit judgment calls (name mismatch vs. ID, a PEP hit, an expired document, a high-risk country above a threshold needing compliance sign-off) and its own new-hire cases the expert never showed; vitest on data invariants; capture and tutor unchanged. |

## Build queue

Partial before Missing, then Required → Stretch → Moonshot → Beyond, then smallest first. Overlaps to watch are in bold. All Required rows are now Built.

| # | ID | Files it will likely touch |
|---|---|---|
| 1 | S-04 Presidio | `be/pyproject.toml`, `be/uv.lock`, `be/src/services/privacy.py`, `be/main.py` (`/health`), `be/tests/test_privacy.py` (new) |
| 2 | S-06 tutor KB and Procedures payloads | `be/src/services/tutor_kb.py` (new), **`be/src/router/path_router.py`**, `be/tests/test_tutor_kb.py` (new) |
| 3 | S-03 agent-ready export | `be/src/services/agent_export.py` (new), **`be/src/router/path_router.py`**, `ui/components/WorkMap.tsx`, `ui/lib/work-maps.ts`, `be/tests/test_agent_export.py` (new) |
| 4 | B-12 UI lint clean | **`ui/components/Sia.tsx`** and the few other files `npm run lint` flags (formatting only) |
| 5 | B-01 rest of the backend tests | `be/tests/test_work_map_edit.py`, `test_tutor_report.py`, `test_privacy.py`, `test_router.py` (new), `be/tests/conftest.py`, `be/pyproject.toml` |
| 6 | B-07 real Settings page | `ui/routes/settings.tsx`, `ui/lib/settings.ts` (new, + test) |
| 7 | B-02 backend lint clean | Nearly every `be/**/*.py`, `be/pyproject.toml`: **run with no other backend work in flight** |
| 8 | S-01 two-session diff (backend) | `be/src/services/work_map_diff.py` (new), **`be/src/router/path_router.py`**, `be/tests/` |
| 9 | S-05 MCP guardrail server | `be/src/mcp_server.py` (new), `be/main.py`, **`be/pyproject.toml`**, **`be/uv.lock`**, `be/tests/` |
| 10 | M-04 anonymized catalog | `be/src/services/anonymize.py` (new), **`be/src/router/path_router.py`**, `ui/routes/catalog.tsx` (new), `ui/routeTree.gen.ts`, `be/tests/` |
| 11 | M-02 coverage check (backend) | `be/src/services/coverage.py` (new), **`be/src/router/path_router.py`**, `be/storage/work_maps.py`, `be/tests/` |
| 12 | M-01 merge a repeat session into its map | `be/src/services/work_map_update.py` (new), **`be/src/router/path_router.py`**, `be/src/services/work_map_merge.py`, `be/storage/work_maps.py`, `be/tests/` |
| 13 | M-03 autopilot (after S-03) | `ui/lib/autopilot.ts` (new, + test), **`ui/routes/sandbox.tsx`**, **`be/src/router/path_router.py`**, `be/src/services/agent_export.py` |
| 14 | B-13 teach-back check against the map | `be/src/services/teach_back_check.py` (new), `be/src/services/work_map_merge.py`, **`be/src/router/path_router.py`**, **`ui/hooks/use-apprentice.ts`**, `ui/lib/floor.ts` (+ test), `be/tests/` |
| 15 | B-06 claims sandbox | `ui/lib/sandbox-claims.ts` (new, + test), **`ui/routes/sandbox.tsx`** or `ui/routes/claims.tsx` (new), `ui/routeTree.gen.ts` |
| 16 | B-14 KYC sandbox (after B-06) | `ui/lib/sandbox-kyc.ts` (new, + test), **`ui/routes/sandbox.tsx`** (workflow switch from B-06) |
| 17 | B-03 search across maps | `be/storage/work_maps.py`, **`be/src/router/path_router.py`**, `ui/routes/work-maps.index.tsx`, `ui/lib/work-maps.ts` |
| 18 | B-04 analytics | `be/src/services/analytics.py` (new), `be/storage/lessons.py`, **`be/src/router/path_router.py`**, `ui/routes/analytics.tsx` (new), `ui/routeTree.gen.ts`, `ui/components/AppHeader.tsx` |
| 19 | B-08 workspaces | `be/storage/work_maps.py`, `be/storage/lessons.py`, **`be/src/router/path_router.py`**, `ui/lib/backend.ts`, `ui/components/AppHeader.tsx` |
| 20 | B-05 generated practice cases | `be/src/services/practice_cases.py` (new), **`be/src/router/path_router.py`**, `ui/lib/sandbox.ts`, **`ui/routes/sandbox.tsx`**, `ui/lib/practice-schedule.ts` (new) |
| 21 | B-09 living map UI (after M-01) | `ui/components/WorkMap.tsx`, **`ui/hooks/use-apprentice.ts`**, `ui/lib/work-maps.ts` |
| 22 | B-10 diff view (after S-01) | `ui/routes/work-maps.compare.tsx` (new), `ui/routeTree.gen.ts`, `ui/lib/work-maps.ts` |
| 23 | B-11 novel-case inbox (after M-02) | `ui/routes/inbox.tsx` (new), `ui/routeTree.gen.ts`, **`ui/hooks/use-apprentice.ts`** |

Coordinator notes:
- `be/tests/conftest.py` exists now (fake AsyncOpenAI): new backend rows add their own `test_*.py` and reuse it rather than writing a second one. S-04 and B-01 both want `test_privacy.py`: give it to whichever runs first.
- Almost every backend row adds an endpoint to `be/src/router/path_router.py`. Adding a new router module per feature (`be/src/router/<feature>.py`, included in `be/main.py`) would remove most of these conflicts.
- S-04 and S-05 both change `be/pyproject.toml` and `be/uv.lock`: run them one after the other.
- B-12 reformats `Sia.tsx`; B-02 touches every backend file. Each should run when nothing else edits those files.
- `ui/routeTree.gen.ts` is generated: rows that add routes should regenerate it, not hand-merge it.
- New tables or columns need a migration the user applies (see *Needs the user*). Rows above keep new data in existing jsonb columns so they don't need one.

## Check results

| Command | Result |
|---|---|
| `.claude/check.sh bd15def` | **Passed** (ALL CHECKS PASSED): UI tests 4 files / 64 tests, UI build, backend import, backend tests 24 passed; no eslint or ruff increase in any file changed since `bd15def`. |
| `cd core/backend && uvx ruff check --statistics .` | **Failed**: 300 errors, unchanged since the last audit (222 E501, 27 B904, 13 B008, 9 I001, 8 E741, …; 21 auto-fixable). See B-02. |
| `cd pixel-perfect-capture && npm run lint` | **Failed**: 133 problems (124 errors, 9 warnings), nearly all `prettier/prettier`, 118 in `Sia.tsx` (unchanged from its base). See B-12. |

Not run, per the rules: the app, ElevenLabs, OpenAI, Supabase, `./start.sh --sync-agents`.

## Needs the user

- **Apply migration 005** (`be/storage/migrations/005_work_map_confirmation.sql`, adds `work_maps.confirmation`) to the hosted Supabase database. Until then confirmed maps save without the expert's confirming words and the "Confirmed by the expert at mm:ss" line (R-08).
- **Sync the agents to ElevenLabs** (`./start.sh --sync-agents`) after any change to `be/src/services/apprentice_agent.py`. Round 2 didn't change it (the debrief and teach-back gates work through tool replies), so no sync is pending now.
- **Hear it work.** The live voice loop (questions at real pauses, the 3-question debrief, the teach-back gate, the tutor stepping in and the ERP's locked save) can only be judged by a person with a microphone. `be/scripts/rehearse_agent.py` and `rehearse_tutor.py` rehearse over text but spend ElevenLabs credit.
- **Register the MCP server with the tutor (S-05)**: needs a public URL for the backend (tunnel or deploy) and an ElevenLabs tool change.
- **Push the knowledge base and Procedures (S-06)** to the ElevenLabs tutor and switch the tutor from the prompt variable to them: changes the live agent.
- **Apply later SQL migrations** to the hosted Supabase database if a feature adds tables or columns (`be/storage/migrations/`).
- **Real sign-in for workspaces (B-08)**: choosing an auth provider and setting it up (Supabase Auth or other) is a product and account decision.
- **Integrations shown in Settings** (Notion, Confluence, Google Drive, Slack, webhooks): each needs accounts and OAuth apps.
- **Pitch slide for the moonshot path** once M-01 lands: what the slide promises is the user's call.
- **Install bun** (or confirm `npm test` is the intended runner): the agent instructions name `bun run test`, which isn't available here.
