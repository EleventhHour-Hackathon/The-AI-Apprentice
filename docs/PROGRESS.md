# Progress against the brief

2026-10-04 · `bd15def` (docs/lan-testing) · **Required** 22 Built, 5 Partial, 0 Missing · **Stretch** 4 Built, 3 Partial, 2 Missing · **Moonshot** 0 Built, 0 Partial, 4 Missing · **Beyond** 0 Built, 2 Partial, 9 Missing

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
| R-07 | Debrief asks ≥3 follow-ups that were not answered during the task | Partial | Prompt only: `be/src/services/apprentice_agent.py:59`; draft asks for ≥3 gaps `be/src/services/work_map_merge.py:55`. Nothing counts debrief questions; `start_teach_back` is accepted at once (`ui/hooks/use-apprentice.ts:406-409`) | Count the apprentice's debrief questions in `use-apprentice.ts` (a pure `debriefMet()` helper in `lib/floor.ts`, unit-tested), and when `start_teach_back` comes before 3 have been asked, return a tool reply telling the agent how many more gaps to ask (from the draft's `open_questions`, minus ones already answered); show "Debrief 2/3" in the pill. |
| R-08 | Ends with a teach-back the expert confirms; corrections recorded | Partial | `be/src/services/apprentice_agent.py:65-67`, `record_correction`/`confirm_work_map` at `ui/hooks/use-apprentice.ts:395,410-419`, corrections merged at `be/src/router/path_router.py:239`. `confirm_work_map` is not gated: it saves even if no teach-back was ever started | Make `confirm_work_map` refuse (tool reply "explain it back first") unless the node is `teach_back` and an apprentice utterance of teach-back length was spoken in that node; record `teach_back` text and the confirming expert line as captures so the Work Map shows "Confirmed by the expert at mm:ss: '…'"; unit-test the gate as a pure function. |
| R-09 | Work Map: clickable timeline; each step has screen moment, decision, reason in the expert's words, guardrails | Built | `ui/components/WorkMap.tsx:234-900` (thumbs, clips 876, quotes + translation 675-742, "Asked while working" 750), `be/src/router/path_router.py:312-354` | |
| R-10 | Every step and guardrail links to a screen moment and the expert's own words | Partial | Quotes grounded against the transcript and times snapped to real events: `be/src/services/work_map_merge.py:126-139,194-211`, `be/src/services/work_map_links.py:141-243`; gaps are only flagged as *Unlinked* (`ui/components/WorkMap.tsx:185,956`), never closed | In the draft merge, add one debrief gap per item `links.unlinked()` reports ("You changed X at 03:12; why?") ahead of the LLM's gaps, and after the final merge list remaining unlinked items in the map's `open_questions`; pytest for both with the OpenAI call mocked. |
| R-11 | Tutor built from the Work Map watches the new hire's screen | Built | `be/src/router/path_router.py:418-444`, `be/src/services/tutor.py:36-71`, `ui/components/Tutor.tsx:83-88`, `ui/hooks/use-tutor.ts:214-250` | |
| R-12 | Tutor explains each step the way the expert did | Built | `be/src/services/apprentice_agent.py:227-256` (`[DONE]`, expert's words), `ui/hooks/use-tutor.ts:424` | |
| R-13 | Tutor asks the new hire to predict the next decision | Built | `be/src/services/tutor.py:90` (`next_step`), `ui/hooks/use-tutor.ts:419`, `record_prediction` 171-180 | |
| R-14 | Tutor catches a wrong decision **before it is saved** and explains it with the expert's reasoning | Partial | Each screen change is checked (`be/src/services/tutor.py:113-143`) and `[STOP]` is sent at once (`ui/hooks/use-tutor.ts:298-349`), but nothing holds the save: the sandbox confirm button stays live (`ui/routes/sandbox.tsx:83-100,414-480`) and `docs/DEMO.md` tells the judge to wait 2–3 s on the dialog | While the tutor has an open STOP flag, hold the save in the practice ERP: `use-tutor.ts` broadcasts open flags on a `BroadcastChannel("tacit-tutor")` (same origin, pill and sandbox), and `sandbox.tsx` disables Post/Hold/Send with "The tutor wants a word first" until `[FIXED]` or the lesson ends; unit-test the channel helper in a new `ui/lib/tutor-hold.ts`. |
| R-15 | Replays the expert's screen moment when it helps | Built | `ui/hooks/use-tutor.ts:163-170`, `ui/components/Tutor.tsx:263`, `ui/components/ClipPlayer.tsx`, `be/src/router/path_router.py:369-383` | |
| R-16 | Shows what the new hire mastered and what to practice next | Built | `be/src/services/tutor.py:146-187` (computed, not LLM), `ui/components/Tutor.tsx:286-330` | |
| R-17 | A case the expert never showed (judge as new hire) | Built | `ui/lib/sandbox.ts:161-205` (4480 €7,200 equipment pre-coded opex, 4481–4483) | |
| R-18 | Apprentice Test 1, when to ask | Built | Same as R-04; `docs/PITCH.md` slide 3 | |
| R-19 | Apprentice Test 2, what to ask | Built | `be/src/services/apprentice_agent.py:46-53`, `[PAUSE]` carries the last screen events `ui/hooks/use-apprentice.ts:798-810`, labels `be/src/services/live_questions.py:19-23` | |
| R-20 | Apprentice Test 3, when it has understood (debrief done + teach-back proves it) | Partial | Debrief end is the LLM's call alone (`be/src/services/apprentice_agent.py:63`); see R-07, R-08 | Closed by R-07 and R-08; no separate work. |
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
| B-01 | Backend test suite (no tests exist; OpenAI, ElevenLabs and Postgres mocked) | Missing | No `be/tests/`; only UI tests in `ui/lib/*.test.ts`, `ui/test/` | `be/tests/conftest.py` with a fake store and a fake OpenAI client; tests for quote grounding and snapping (`work_map_merge`, `work_map_links`), `work_map_edit.apply`, `tutor.report`, `privacy.redact`, and the router via `TestClient`; add `pytest` to the dev extra. |
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

## Build queue

Partial before Missing, then Required → Stretch → Moonshot → Beyond, then smallest first. Overlaps to watch are in bold.

| # | ID | Files it will likely touch |
|---|---|---|
| 1 | R-08 teach-back gate | **`ui/hooks/use-apprentice.ts`**, `ui/lib/floor.ts` (+ `floor.test.ts`), `ui/components/WorkMap.tsx`, `be/src/router/path_router.py` (merge: confirmation capture) |
| 2 | R-07 debrief ≥3 follow-ups | **`ui/hooks/use-apprentice.ts`**, `ui/lib/floor.ts` (+ `floor.test.ts`), `ui/components/Sia.tsx`, `be/src/services/apprentice_agent.py` (prompt line, no sync) |
| 3 | R-10 close unlinked gaps | `be/src/services/work_map_merge.py`, `be/src/services/work_map_links.py`, `be/tests/` (new) |
| 4 | R-14 hold the save while the tutor steps in | `ui/hooks/use-tutor.ts`, `ui/lib/tutor-hold.ts` (new, + test), **`ui/routes/sandbox.tsx`**, `docs/DEMO.md` |
| 5 | S-04 Presidio | `be/pyproject.toml`, `be/uv.lock`, `be/src/services/privacy.py`, `be/main.py` (`/health`), `be/tests/` |
| 6 | S-03 agent-ready export | `be/src/services/agent_export.py` (new), **`be/src/router/path_router.py`**, `ui/components/WorkMap.tsx`, `ui/lib/work-maps.ts`, `be/tests/` |
| 7 | S-06 tutor KB and Procedures payloads | `be/src/services/tutor_kb.py` (new), **`be/src/router/path_router.py`**, `be/tests/` |
| 8 | B-07 real Settings page | `ui/routes/settings.tsx`, `ui/lib/settings.ts` (new, + test) |
| 9 | B-02 lint clean | Nearly every `be/**/*.py`, `be/pyproject.toml`: **run with no other backend work in flight** |
| 10 | S-01 two-session diff (backend) | `be/src/services/work_map_diff.py` (new), **`be/src/router/path_router.py`**, `be/tests/` |
| 11 | S-05 MCP guardrail server | `be/src/mcp_server.py` (new), `be/main.py`, `be/pyproject.toml`, `be/uv.lock`, `be/tests/` |
| 12 | M-04 anonymized catalog | `be/src/services/anonymize.py` (new), **`be/src/router/path_router.py`**, `ui/routes/catalog.tsx` (new), `ui/routeTree.gen.ts`, `be/tests/` |
| 13 | M-02 coverage check (backend) | `be/src/services/coverage.py` (new), **`be/src/router/path_router.py`**, `be/storage/work_maps.py`, `be/tests/` |
| 14 | M-01 merge a repeat session into its map | `be/src/services/work_map_update.py` (new), **`be/src/router/path_router.py`**, `be/src/services/work_map_merge.py`, `be/storage/work_maps.py`, `be/tests/` |
| 15 | M-03 autopilot (after S-03) | `ui/lib/autopilot.ts` (new, + test), **`ui/routes/sandbox.tsx`**, **`be/src/router/path_router.py`**, `be/src/services/agent_export.py` |
| 16 | B-01 backend test suite | `be/tests/conftest.py` and `be/tests/test_*.py` (new), `be/pyproject.toml` |
| 17 | B-06 claims sandbox | `ui/lib/sandbox-claims.ts` (new, + test), **`ui/routes/sandbox.tsx`** or `ui/routes/claims.tsx` (new), `ui/routeTree.gen.ts` |
| 18 | B-03 search across maps | `be/storage/work_maps.py`, **`be/src/router/path_router.py`**, `ui/routes/work-maps.index.tsx`, `ui/lib/work-maps.ts` |
| 19 | B-04 analytics | `be/src/services/analytics.py` (new), `be/storage/lessons.py`, **`be/src/router/path_router.py`**, `ui/routes/analytics.tsx` (new), `ui/routeTree.gen.ts`, `ui/components/AppHeader.tsx` |
| 20 | B-08 workspaces | `be/storage/work_maps.py`, `be/storage/lessons.py`, **`be/src/router/path_router.py`**, `ui/lib/backend.ts`, `ui/components/AppHeader.tsx` |
| 21 | B-05 generated practice cases | `be/src/services/practice_cases.py` (new), **`be/src/router/path_router.py`**, `ui/lib/sandbox.ts`, **`ui/routes/sandbox.tsx`**, `ui/lib/practice-schedule.ts` (new) |
| 22 | B-09 living map UI (after M-01) | `ui/components/WorkMap.tsx`, `ui/hooks/use-apprentice.ts`, `ui/lib/work-maps.ts` |
| 23 | B-10 diff view (after S-01) | `ui/routes/work-maps.compare.tsx` (new), `ui/routeTree.gen.ts`, `ui/lib/work-maps.ts` |
| 24 | B-11 novel-case inbox (after M-02) | `ui/routes/inbox.tsx` (new), `ui/routeTree.gen.ts`, `ui/hooks/use-apprentice.ts` |

Coordinator notes:
- R-07 and R-08 both change `use-apprentice.ts` and `lib/floor.ts`: give them to the same implementer, or run them one after the other.
- Almost every backend row adds an endpoint to `be/src/router/path_router.py`. Adding a new router module per feature (`be/src/router/<feature>.py`, included in `be/main.py`) would remove most of these conflicts.
- No backend tests exist yet. The first backend row to run creates `be/tests/conftest.py`; later rows reuse it rather than writing a second one.
- `ui/routeTree.gen.ts` is generated: rows that add routes should regenerate it, not hand-merge it.
- New tables need a migration applied to the hosted Supabase DB (see *Needs the user*). Rows above keep new data in existing jsonb columns so they don't need one.

## Check results

| Command | Result |
|---|---|
| `cd pixel-perfect-capture && bun run test` | Not run: `bun` is not installed on this machine. |
| `cd pixel-perfect-capture && npm test` (vitest) | **Passed**: 3 files, 23 tests (`lib/floor.test.ts`, `lib/pii.test.ts`, `test/app-routing.test.tsx`). |
| `cd core/backend && uv run ruff check .` | Could not run: ruff is only in the `dev` extra and is not installed in the venv. |
| `cd core/backend && uvx ruff check .` | **Failed**: 300 errors (222 E501 line-too-long, 27 B904, 13 B008, 9 I001, 8 E741, plus smaller ones; 21 auto-fixable). See B-02. |
| Backend tests | None exist (B-01). |

Not run, per the rules: the app, ElevenLabs, OpenAI, `./start.sh --sync-agents`.

## Needs the user

- **Sync the agents to ElevenLabs** (`./start.sh --sync-agents`) after any change to `be/src/services/apprentice_agent.py` (R-07 prompt line; future tutor tool changes). It changes the live agents.
- **Hear it work.** The live voice loop (questions at real pauses, debrief, teach-back, the tutor stepping in) can only be judged by a person with a microphone. `be/scripts/rehearse_agent.py` and `rehearse_tutor.py` rehearse over text but spend ElevenLabs credit.
- **Register the MCP server with the tutor (S-05)**: needs a public URL for the backend (tunnel or deploy) and an ElevenLabs tool change.
- **Push the knowledge base and Procedures (S-06)** to the ElevenLabs tutor and switch the tutor from the prompt variable to them: changes the live agent.
- **Apply SQL migrations** to the hosted Supabase database if a feature needs new tables or columns (`be/storage/migrations/`).
- **Real sign-in for workspaces (B-08)**: choosing an auth provider and setting it up (Supabase Auth or other) is a product and account decision.
- **Integrations shown in Settings** (Notion, Confluence, Google Drive, Slack, webhooks): each needs accounts and OAuth apps.
- **Pitch slide for the moonshot path** once M-01 lands: what the slide promises is the user's call.
- **Install bun** (or confirm `npm test` is the intended runner): the agent instructions name `bun run test`, which isn't available here.
