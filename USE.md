# USE: the laptop where the app is tested

This laptop only runs the Electron window. The UI and the backend are served live by the dev
laptop, **`mithras-mbp.lan`**, on the same network, so every UI change shows up here in about two
seconds, with no git push or pull. The dev laptop must be serving first: see [DEV.md](DEV.md).

You don't need Python, the backend or any API keys here.
The microphone and screen capture come from **this** laptop, as they would for a real user.

## One-time setup

1. Install Node 20+ (e.g. `nvm install 24`).
2. Set up ssh to the dev laptop, so you can copy files without a password:

   ```sh
   ssh-keygen -t ed25519            # skip if ~/.ssh/id_ed25519 exists
   ssh-copy-id gsnmithra@mithras-mbp.lan
   ```

   (Remote Login must be on for the dev laptop: System Settings → General → Sharing.)
3. Copy the app from the dev laptop, without `node_modules`, and install dependencies:

   ```sh
   rsync -a --exclude node_modules gsnmithra@mithras-mbp.lan:.builds/tacit/pixel-perfect-capture ~/
   cd ~/pixel-perfect-capture && npm install
   ```

   If this laptop has its own clone of the repo, you can use that instead and sync just the
   Electron shell: `rsync -a gsnmithra@mithras-mbp.lan:.builds/tacit/pixel-perfect-capture/electron/ electron/`.

## Every session

1. Check the dev laptop is serving: open `http://mithras-mbp.lan:8081` and
   `http://mithras-mbp.lan:8000/health` in a browser.
2. Start the app:

   ```sh
   cd ~/pixel-perfect-capture && APP_URL=http://mithras-mbp.lan:8081 npx electron .
   ```

3. The first time, allow **Microphone** and **Screen Recording** when macOS asks
   (System Settings → Privacy & Security). After granting screen recording, quit and restart the
   app.

## What updates live

- **UI changes:** appear in about two seconds, no reload.
- **Backend changes:** live once the dev laptop's backend reloads.
- **Changes to `electron/main.cjs` or `preload.cjs`:** these run here. Rerun the `rsync` command
  and restart the app.
- **New dependencies:** rerun `npm install` here.

## Troubleshooting

- **Blank window or "can't connect":** the dev laptop's servers aren't running, its firewall is
  blocking them, or the network blocks traffic between devices. Check the URLs in a browser first.
- **The UI loads but data doesn't:** the dev laptop's UI wasn't started with
  `VITE_BACKEND_URL=http://mithras-mbp.lan:8000`, or its `CORS_ORIGINS` is missing
  `http://mithras-mbp.lan:8081`. See DEV.md.
- **The mic or screen capture doesn't work:** grant the permissions above and restart the app.
  If it still fails, this laptop's `electron/main.cjs` is out of date; rerun the `rsync` command.
