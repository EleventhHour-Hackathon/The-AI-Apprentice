# USE: the laptop where the app is tested

This laptop only runs the Electron window. The UI and the backend are served live by the dev
laptop on the same network, so every UI change shows up here instantly, with no git push or pull.
The dev laptop must be set up first: see [DEV.md](DEV.md).

You don't need Python, the backend or any API keys here.
The microphone and screen capture come from **this** laptop, as they would for a real user.

`DEV_HOST` below stands for the dev laptop's address: its IP (e.g. `192.168.1.56`) or, better,
its `.local` name (e.g. `Mithras-MacBook-Pro-M5.local`). The `.local` name keeps working when the
IP changes, but only once the dev laptop allows it in Vite (see DEV.md).

## One-time setup

1. Install Node 20+ (e.g. `nvm install 24`) and optionally [bun](https://bun.sh).
2. Copy the `pixel-perfect-capture` folder from the dev laptop, without `node_modules`. Use
   AirDrop, or:

   ```sh
   rsync -a --exclude node_modules DEV_USER@DEV_HOST:~/.builds/sia/pixel-perfect-capture ~/
   ```

   (`rsync` over ssh needs Remote Login turned on on the dev laptop: System Settings → General →
   Sharing.)
3. Install dependencies:

   ```sh
   cd ~/pixel-perfect-capture && bun install   # or: npm install
   ```

## Every session

1. Check the dev laptop is serving: open `http://DEV_HOST:8080` and `http://DEV_HOST:8000/health`
   in a browser.
2. Start the app:

   ```sh
   cd ~/pixel-perfect-capture && APP_URL=http://DEV_HOST:8080 npx electron .
   ```

3. The first time, allow **Microphone** and **Screen Recording** when macOS asks
   (System Settings → Privacy & Security). After granting screen recording, quit and restart the
   app.

## What updates live

- **UI changes:** appear instantly, no reload.
- **Backend changes:** live once the dev laptop's backend reloads.
- **Changes to `electron/main.cjs` or `preload.cjs`:** these run here. Copy the new file over
  (rerun the `rsync` command) and restart the app.
- **New dependencies:** rerun `bun install` here.

## Troubleshooting

- **Blank window or "can't connect":** the dev laptop's servers aren't running, its firewall is
  blocking them, or the network blocks traffic between devices. Check the URLs in a browser first.
- **The UI loads but data doesn't:** the dev laptop's UI isn't pointed at its own network address
  (`VITE_BACKEND_URL`), or its `CORS_ORIGINS` is missing `http://DEV_HOST:8080`. See DEV.md.
- **The mic or screen capture doesn't work:** grant the permissions above and restart the app.
  If it still fails, the `unsafely-treat-insecure-origin-as-secure` line from DEV.md is missing
  from `electron/main.cjs`.
