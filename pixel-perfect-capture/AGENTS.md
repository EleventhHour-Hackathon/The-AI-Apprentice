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
- The pill is the whole UI. The apprentice backend (`core/backend`, default `http://localhost:8000`, override with `VITE_BACKEND_URL`) drives the session; the flow lives in `core/backend/src/services/flows/apprentice.json`.
- `use-apprentice` owns the Pipecat/Daily connection, bot audio and microphone cleanup. Keep voice transport there.
- `use-screen-events` samples the shared screen, skips unchanged frames, posts the rest to `/api/v1/screen_event`, and feeds changes to the bot as `[SCREEN]` context.
- Show an answer as captured only after the backend sends a `work_map.*` server message, never on a timer.
- Flow position comes from `flow.node` server messages. Pill controls go back as client messages (`work.end`, `question.later`, `debrief.skip`) handled in `InterviewFlow._handle_client_message`.
- Screen thumbnails are taken from the live screen share and kept in memory only. The backend saves the Work Map to the `work_maps` table in Supabase (`core/backend/storage/work_maps.py`), falling back to `uploads/work_maps/` only if Supabase is unreachable.
- Work Maps (`/work-maps`) read and delete saved maps through `/api/v1/work_maps[/{id}]` and draw them with React Flow in `WorkMap.tsx`. Only the backend touches the Supabase table (RLS on, no policies). Guardrails, open questions and corrections are not tied to a step in the saved data, so they sit in their own lanes; do not draw links the backend did not record.
