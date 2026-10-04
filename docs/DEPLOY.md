# Deploying the Tacit backend on Render

One hosted backend holds every API key and all data. The desktop app only needs its URL and the
access key. The service is described in `render.yaml` (repo root) and built from
`core/backend/Dockerfile`.

## 1. Create the service from the Blueprint

1. Push the branch with `render.yaml` to GitHub (Render reads the repo's default branch).
2. In the Render dashboard: **New > Blueprint**, connect GitHub, and pick this repo
   (give Render access to it if it's private).
3. Render shows one web service, `tacit-backend`, and asks for the secrets below. Paste each one
   (the values are in `core/backend/.env.development` on your machine):

   | Variable | What it is |
   |---|---|
   | `OPENAI_API_KEY` | OpenAI key (screen reading, Work Maps, tutor) |
   | `ELEVENLABS_API_KEY` | ElevenLabs key (voice agent tokens) |
   | `SUPABASE_DB_URL` | Supabase Postgres connection string |
   | `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_...`) or legacy `service_role` key, for recordings in Storage |

   `TACIT_ACCESS_KEY` is not asked for: Render generates it.
4. Click **Apply**. The first build takes several minutes (Presidio and spaCy are in the image).

## 2. Copy the URL and the access key

- URL: at the top of the service page, like `https://tacit-backend-xxxx.onrender.com`.
  Build the desktop app with it: `VITE_BACKEND_URL=https://tacit-backend-xxxx.onrender.com`.
- Access key: service page > **Environment** > `TACIT_ACCESS_KEY` > reveal and copy. Give it to
  the people who use the app; they paste it in the "Connect to Tacit" screen.
  To change it, edit the value there and save (Render redeploys); every app then needs the new key.

## 3. Check it

```sh
curl https://tacit-backend-xxxx.onrender.com/health
# {"message":"Server is healthy", ..., "privacy":{"names":true,"engine":"presidio"},"access":"key"}

curl -i https://tacit-backend-xxxx.onrender.com/api/v1/agent/token
# HTTP/1.1 401 ... {"detail":"Missing or wrong access key"}

curl -H "X-Tacit-Key: <the key>" https://tacit-backend-xxxx.onrender.com/api/v1/agent/token
# {"token": "...", "agent_id": "..."}
```

Every request sends the key in the `X-Tacit-Key` header. The one exception is the clip video,
`GET /api/v1/sessions/{id}/clip`, which also takes it as `?key=<the key>` because a `<video src>`
can't send headers. No other route accepts `?key=`. The server doesn't write an access log, so
those URLs aren't recorded.

`"access": "key"` means the key is enforced. `"open"` means `TACIT_ACCESS_KEY` is empty: fix
that before sharing the URL.

## ElevenLabs agents

The voice agents already live in your ElevenLabs account; the backend finds them by name with
`ELEVENLABS_API_KEY`. Nothing to sync for a deploy. Only after changing the prompts in
`apprentice_agent.py` run `./start.sh --sync-agents` once, from your machine.

## What persists

- Work Maps, sessions, screen moments and lessons: Supabase Postgres. Persist.
- Recordings and clips: Supabase Storage (`screen-recordings` bucket). Persist, as long as
  `SUPABASE_SECRET_KEY` is set. Until an upload succeeds a file waits in `uploads/` on the
  server's disk, which Render wipes on every deploy, restart and (on the free plan) sleep.
- Nothing else is kept on the server.

The database schema is already in place from local use (`core/backend/storage/migrations/`);
a new Supabase project needs those SQL files run first.

## Plan

`render.yaml` uses the free plan: it sleeps after 15 idle minutes and the next request waits
about a minute while it starts. For a demo or real users, switch the service to a paid instance
(0.5c-512mb or larger) under **Settings > Instance type**.

## Locally

Leave `TACIT_ACCESS_KEY` unset and the backend stays open, as before. To try the image:

```sh
docker build -t tacit-backend core/backend
docker run -p 8000:8000 --env-file core/backend/.env.development tacit-backend
```
