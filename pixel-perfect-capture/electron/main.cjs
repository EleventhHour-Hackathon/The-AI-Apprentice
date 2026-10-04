// Electron shell for Tacit: a normal app window, plus the voice
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
const fs = require("node:fs");
const path = require("node:path");

app.setName("Tacit");

// The UI is served by the Vite dev server (`bun run desktop` starts both).
const APP_URL = (process.env.APP_URL || "http://localhost:8081").replace(/\/+$/, "");
// Chromium only allows the mic and screen capture on https or localhost. Treat APP_URL as
// secure too, so the app works when its UI is served from another laptop over plain http.
app.commandLine.appendSwitch("unsafely-treat-insecure-origin-as-secure", APP_URL);
const PILL_WIDTH = 480;
const PILL_MIN_HEIGHT = 96;
const BOTTOM_GAP = 12;

let mainWindow = null;
let pillWindow = null;
let pillHeight = PILL_MIN_HEIGHT;
// Where the expert dragged the pill: the bottom centre of its window, in screen points.
// null keeps it at the bottom centre of the primary display. The pill grows upwards from here.
let pillAnchor = null;
let dragFrom = null;

const preload = path.join(__dirname, "preload.cjs");
const anchorFile = () => path.join(app.getPath("userData"), "pill-position.json");

function loadAnchor() {
  try {
    const { x, y } = JSON.parse(fs.readFileSync(anchorFile(), "utf8"));
    if (Number.isFinite(x) && Number.isFinite(y)) pillAnchor = { x, y };
  } catch {
    pillAnchor = null;
  }
}

function saveAnchor() {
  try {
    if (pillAnchor) fs.writeFileSync(anchorFile(), JSON.stringify(pillAnchor));
    else fs.rmSync(anchorFile(), { force: true });
  } catch {
    // Only a convenience; the pill still works where it is.
  }
}

function defaultAnchor() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width / 2, y: workArea.y + workArea.height - BOTTOM_GAP };
}

function placePill() {
  if (!pillWindow) return;
  const anchor = pillAnchor ?? defaultAnchor();
  // Keep the whole window on the display it was dropped on, even if that display changed.
  const { workArea } = screen.getDisplayNearestPoint({
    x: Math.round(anchor.x),
    y: Math.round(anchor.y),
  });
  const height = Math.min(pillHeight, workArea.height);
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  pillWindow.setBounds({
    x: Math.round(
      clamp(anchor.x - PILL_WIDTH / 2, workArea.x, workArea.x + workArea.width - PILL_WIDTH),
    ),
    y: Math.round(clamp(anchor.y - height, workArea.y, workArea.y + workArea.height - height)),
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
    title: "Tacit",
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
// Dragging: the renderer sends how far the cursor has moved since the drag began.
ipcMain.on("pill:drag-start", () => {
  dragFrom = pillAnchor ?? defaultAnchor();
});
ipcMain.on("pill:drag", (_event, dx, dy) => {
  if (!dragFrom || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  pillAnchor = { x: dragFrom.x + dx, y: dragFrom.y + dy };
  placePill();
});
ipcMain.on("pill:drag-end", () => {
  if (!dragFrom || !pillWindow) return;
  dragFrom = null;
  // Store where it actually landed, after clamping to the screen.
  const b = pillWindow.getBounds();
  pillAnchor = { x: b.x + b.width / 2, y: b.y + b.height };
  saveAnchor();
});
ipcMain.on("pill:reset-position", () => {
  pillAnchor = null;
  saveAnchor();
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
  else if (typeof command === "string" && command.startsWith("open:/")) {
    // Bring the app window forward on a page of the app, e.g. open:/work-maps/<id>.
    mainWindow?.loadURL(`${APP_URL}${command.slice("open:".length)}`);
    showMain();
  } else if (typeof command === "string" && command.startsWith("lesson:")) {
    // A new hire works their own screen: get the app window out of the way.
    commandPill(command);
    mainWindow?.minimize();
  } else if (command === "pill-only") {
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

  loadAnchor();
  screen.on("display-metrics-changed", placePill);
  screen.on("display-removed", placePill);
  createMain();
  createPill();
  // Show the interface before a permission prompt can delay startup.
  if (process.platform === "darwin") {
    void systemPreferences.askForMediaAccess("microphone").catch(() => false);
  }
});

app.on("window-all-closed", () => app.quit());
