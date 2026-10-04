<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Voice architecture
- The voice agent is an ElevenLabs agent (ElevenAgents). Its prompt, voice, turn-taking and client tools are defined in `core/backend/src/services/apprentice_agent.py`; run `uv run python -m src.services.apprentice_agent` there after changing it. Never edit the agent in the ElevenLabs dashboard, the next sync overwrites it. `scripts/rehearse_agent.py` replays a scripted session over text to check its behaviour.
- `use-apprentice` owns the ElevenLabs conversation (`@elevenlabs/client`, WebRTC with a token from `/api/v1/agent/token`), the client tools and the session record. Keep voice transport there.
- When to speak is decided in the pill, not by the agent: `lib/floor.ts` (tested) reads talking (VAD), typing/scrolling (screen pixel activity) and reading (a document just opened), and sends `[PAUSE]` only after an on-screen action, within a question budget. Replies the agent makes without the floor are muted and it is told `[NOT HEARD]`.
- `use-screen-events` runs a fast local activity check and a slower vision call (`/api/v1/screen_event`); changes reach the agent as silent `[SCREEN mm:ss]` context updates and are stored with a thumbnail as screen moments.
- Show an answer as captured only after the agent calls a recording tool, never on a timer.
- Work Maps are merged by `core/backend/src/services/work_map_merge.py` from screen events, transcript and live captures: a draft at `start_debrief` (its gaps drive the debrief) and the final map at `confirm_work_map`. Quotes must appear in what the expert said and times are snapped to screen events; keep it that way.
- Supabase holds sessions (`work_maps`) and screen moments (`screen_events`); only the backend touches them (RLS on, no policies). Schema changes go in `core/backend/storage/migrations/`.
- Work Maps (`/work-maps`) draw with React Flow in `WorkMap.tsx`: steps on a timeline with their screen moment, guardrails under the step they belong to. Do not draw links the merge did not record.
- Teaching (Module 3): the tutor is a second ElevenLabs agent ("AI Apprentice Tutor", same file as the apprentice) that gets the Work Map as the `work_map` dynamic variable. `use-tutor` + `Tutor.tsx` run a lesson in the pill (desktop: `lesson:<work map id>` pill command; browser: `/?lesson=<id>`). Every screen event is checked by `/api/v1/lessons/{id}/check` (`core/backend/src/services/tutor.py`), which applies the expert's rules to the new case; `intervene` sends `[STOP]` at once (stepping in is the point here), predictions and explanations wait for a pause. The report (mastered / practice next / not covered) is computed from recorded attempts, not by an LLM. `scripts/rehearse_tutor.py <work map id>` replays a lesson over text.
