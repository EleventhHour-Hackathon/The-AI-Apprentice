// Electron shell for the AI Apprentice: a normal app window, plus the voice
// pill floating above every other window on the desktop.
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  session,
  systemPreferences,
} = require("electron");
const path = require("node:path");

// The UI is served by the Vite dev server (`bun run desktop` starts both).
const APP_URL = (process.env.APP_URL || "http://localhost:8080").replace(/\/+$/, "");
const PILL_WIDTH = 480;
const PILL_MIN_HEIGHT = 96;
const BOTTOM_GAP = 12;

let mainWindow = null;
let pillWindow = null;
let pillHeight = PILL_MIN_HEIGHT;

const preload = path.join(__dirname, "preload.cjs");

function placePill() {
  if (!pillWindow) return;
  const { workArea } = screen.getPrimaryDisplay();
  const height = Math.min(pillHeight, workArea.height - BOTTOM_GAP);
  pillWindow.setBounds({
    x: Math.round(workArea.x + (workArea.width - PILL_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - height - BOTTOM_GAP),
    width: PILL_WIDTH,
    height,
  });
}

function createPill() {
  pillWindow = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // A non-activating panel on macOS: clicking the pill does not pull the app forward.
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: { preload, autoplayPolicy: "no-user-gesture-required" },
  });
  pillWindow.setAlwaysOnTop(true, "screen-saver");
  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep the pill out of its own screen capture, so the apprentice sees only the work.
  pillWindow.setContentProtection(true);
  // Clicks pass through the transparent area around the pill until the renderer says otherwise.
  pillWindow.setIgnoreMouseEvents(true, { forward: true });
  placePill();
  pillWindow.loadURL(`${APP_URL}/pill`);
  pillWindow.once("ready-to-show", () => pillWindow?.showInactive());
  pillWindow.on("closed", () => {
    pillWindow = null;
  });
}

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    title: "AI Apprentice",
    webPreferences: { preload },
  });
  mainWindow.loadURL(`${APP_URL}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

/** Run a pill command as if it came from a click, so screen capture and audio are allowed. */
function commandPill(command) {
  if (!pillWindow) createPill();
  pillWindow.showInactive();
  const run = () =>
    pillWindow?.webContents.executeJavaScript(
      `window.__apprenticeCommand?.(${JSON.stringify(command)})`,
      true,
    );
  if (pillWindow.webContents.isLoading()) pillWindow.webContents.once("did-finish-load", run);
  else void run();
}

ipcMain.on("pill:resize", (_event, height) => {
  if (typeof height !== "number" || !Number.isFinite(height)) return;
  pillHeight = Math.max(PILL_MIN_HEIGHT, Math.ceil(height));
  placePill();
});
ipcMain.on("pill:interactive", (_event, interactive) => {
  pillWindow?.setIgnoreMouseEvents(!interactive, { forward: true });
});
ipcMain.on("pill:command", (_event, command) => {
  if (command === "show") {
    if (!pillWindow) createPill();
    else pillWindow.showInactive();
  } else if (command === "hide") pillWindow?.hide();
  else if (command === "start") commandPill("start");
  else if (command === "app") showMain();
  else if (command === "pill-only") {
    if (!pillWindow) createPill();
    else pillWindow.showInactive();
    mainWindow?.minimize();
  }
});

/** Bring the app window to the front, even from the non-activating pill. */
function showMain() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (process.platform === "darwin") app.focus({ steal: true });
  mainWindow.focus();
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    // Ask up front; macOS only lists screen recording in System Settings once the app has asked.
    await systemPreferences.askForMediaAccess("microphone").catch(() => false);
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });
  // getDisplayMedia shares the whole primary screen, the way the expert actually works.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const primary = screen.getPrimaryDisplay().id.toString();
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const source = sources.find((s) => s.display_id === primary) ?? sources[0];
      callback(source ? { video: source } : {});
    } catch {
      callback({});
    }
  });

  screen.on("display-metrics-changed", placePill);
  createMain();
  createPill();
});

app.on("window-all-closed", () => app.quit());
