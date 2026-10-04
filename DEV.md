# DEV: the laptop where the code is written

This laptop runs everything: the backend (`:8000`) and the UI dev server (`:8080`).
A second laptop on the same network shows the app from here, so code changes reach it live,
with no git push or pull. See [USE.md](USE.md) for the other laptop.

```
Dev laptop (this one)                        Test laptop
┌─────────────────────────────┐              ┌──────────────────────┐
│ You edit code               │              │ Electron window      │
│ Vite dev server   :8080  ◄──┼── UI + HMR ──┤  loads the UI and    │
│ FastAPI backend   :8000  ◄──┼── API calls ─┤  calls the API here  │
└─────────────────────────────┘   (Wi-Fi)    └──────────────────────┘
```

## Your address on the network

```sh
ipconfig getifaddr en0          # e.g. 192.168.1.56
scutil --get LocalHostName      # e.g. Mithras-MacBook-Pro-M5  →  Mithras-MacBook-Pro-M5.local
```

The IP works out of the box. The `.local` name keeps working when the router hands out a new IP,
but Vite rejects it (403 "host not allowed") until you allow it: in
`pixel-perfect-capture/vite.config.ts`, add `vite: { server: { allowedHosts: [".local"] } }` to
the `defineConfig({ ... })` call.
Below, `DEV_HOST` stands for whichever one you use.

## One-time code changes

These are needed before the test laptop can use the app. Commit them so both laptops have them.

1. **Let the backend accept the test laptop.** In `core/backend/src/core/config.py`, add the UI's
   network address to `CORS_ORIGINS`:

   ```python
   "http://DEV_HOST:8080",
   ```

   Without it, every API call from the test laptop is blocked by CORS.

2. **Let Electron use the mic and screen over plain http.** Chromium only allows the mic and
   screen capture on `https` or `localhost`. In `pixel-perfect-capture/electron/main.cjs`, right
   after `APP_URL` is defined, add:

   ```js
   app.commandLine.appendSwitch("unsafely-treat-insecure-origin-as-secure", APP_URL);
   ```

   Without it, `navigator.mediaDevices` doesn't exist and voice and screen capture fail.

## Every session

1. Start the backend. In development it reloads itself when Python files change:

   ```sh
   cd core/backend && uv run main.py
   ```

2. Start the UI, pointing it at this laptop's backend. The default (`localhost:8000`) would make
   the test laptop look for a backend on itself:

   ```sh
   cd pixel-perfect-capture && VITE_BACKEND_URL=http://DEV_HOST:8000 bun run dev
   ```

   Both servers already listen on every network interface, not just localhost.

3. Check from the test laptop's browser that `http://DEV_HOST:8000/health` and
   `http://DEV_HOST:8080` load.

## What updates live

| You change                         | On the test laptop                      |
| ---------------------------------- | --------------------------------------- |
| React / UI code (`src/`)           | Updates instantly (HMR)                 |
| Backend Python (`core/backend/`)   | Live after the backend auto-reloads     |
| `electron/main.cjs`, `preload.cjs` | Copy the file over and restart the app  |
| Dependencies (`package.json`)      | Run `bun install` on the test laptop too |

## Troubleshooting

- **The test laptop can't connect:** turn off the macOS firewall, or allow incoming connections
  for `node` and `python` (System Settings → Network → Firewall). Some guest or office Wi-Fi blocks
  traffic between devices; use a home network or a phone hotspot.
- **API calls fail with a CORS error:** the origin in `CORS_ORIGINS` must match exactly what the
  test laptop loads, including `http://` and `:8080`.
- **The IP changed:** use the `.local` name, or update `VITE_BACKEND_URL`, `CORS_ORIGINS` and
  `APP_URL` on the test laptop.
