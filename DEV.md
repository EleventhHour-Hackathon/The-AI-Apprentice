# DEV: the laptop where the code is written

The dev laptop is **`mithras-mbp.lan`** (repo at `~/.builds/tacit`). It runs the backend (`:8000`)
and the UI dev server (`:8081`). A second laptop on the same network shows the app from here, so
code changes reach it live, with no git push or pull. See [USE.md](USE.md) for the other laptop.

```
mithras-mbp.lan (dev)                        Test laptop
┌─────────────────────────────┐              ┌──────────────────────┐
│ You edit code               │              │ Electron window      │
│ Vite dev server   :8081  ◄──┼── UI + HMR ──┤  loads the UI and    │
│ FastAPI backend   :8000  ◄──┼── API calls ─┤  calls the API here  │
└─────────────────────────────┘   (Wi-Fi)    └──────────────────────┘
```

The UI runs on 8081, not Lovable's usual 8080, because a `signal-cli` daemon on this laptop
already uses `127.0.0.1:8080`.

## What's already in the code

- `pixel-perfect-capture/vite.config.ts`: port 8081, and `allowedHosts: [".lan", ".local"]` so
  Vite serves the UI by name. Without it, Vite answers `mithras-mbp.lan` with a 403.
- `core/backend/src/core/config.py`: `http://mithras-mbp.lan:8081` is in `CORS_ORIGINS`, so the
  test laptop's API calls aren't blocked.
- `pixel-perfect-capture/electron/main.cjs`: treats `APP_URL` as a secure origin
  (`unsafely-treat-insecure-origin-as-secure`). Chromium only allows the mic and screen capture on
  https or localhost, so without it voice and screen capture fail over plain http.

If the dev laptop ever gets a different name, change it in `CORS_ORIGINS`.

## Every session

1. Start the backend. In development it reloads itself when Python files change:

   ```sh
   cd ~/.builds/tacit/core/backend && uv run main.py
   ```

   To redact people's names in transcripts too (Presidio), run `uv sync --extra privacy` once
   first. `uv run` keeps it, but a plain `uv sync` removes it again. When it's on, `/health`
   shows `"privacy": {"names": true, "engine": "presidio"}`. `./start.sh` installs it by default;
   `--no-privacy` skips it.

2. Start the UI, pointing it at this laptop's backend by name. The default (`localhost:8000`)
   would make the test laptop look for a backend on itself:

   ```sh
   cd ~/.builds/tacit/pixel-perfect-capture && VITE_BACKEND_URL=http://mithras-mbp.lan:8000 npm run dev
   ```

   Both servers listen on every network interface, not just localhost.

3. Check that `http://mithras-mbp.lan:8000/health` and `http://mithras-mbp.lan:8081` load from
   the test laptop's browser.

To run both in the background (e.g. over ssh), so they survive closing the terminal:

```sh
cd ~/.builds/tacit
(cd core/backend && nohup uv run main.py >> app.log 2>&1 < /dev/null &)
(cd pixel-perfect-capture && VITE_BACKEND_URL=http://mithras-mbp.lan:8000 nohup npm run dev > /tmp/tacit-ui.log 2>&1 < /dev/null &)
```

Stop them with `lsof -ti tcp:8000 -ti tcp:8081 | xargs kill`.

## What updates live

| You change                         | On the test laptop                       |
| ---------------------------------- | ---------------------------------------- |
| React / UI code (`src/`)           | Updates in about 2 seconds (HMR)         |
| Backend Python (`core/backend/`)   | Live after the backend auto-reloads      |
| `electron/main.cjs`, `preload.cjs` | Copy the file over and restart the app   |
| Dependencies (`package.json`)      | Run `npm install` on the test laptop too |

## Troubleshooting

- **The test laptop can't connect:** turn off the macOS firewall, or allow incoming connections
  for `node` and `python` (System Settings → Network → Firewall). Some guest or office Wi-Fi blocks
  traffic between devices; use a home network or a phone hotspot.
- **403 "host not allowed" from Vite:** the name isn't in `allowedHosts` in `vite.config.ts`.
- **API calls fail with a CORS error:** the origin in `CORS_ORIGINS` must match exactly what the
  test laptop loads, including `http://` and `:8081`.
- **"Port 8081 is already in use":** a previous dev server is still running; stop it (above).
