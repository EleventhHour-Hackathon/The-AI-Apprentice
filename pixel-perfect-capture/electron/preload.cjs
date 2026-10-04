const { contextBridge, ipcRenderer } = require("electron");

// The small surface the UI uses to talk to the desktop shell (see src/lib/desktop.ts).
contextBridge.exposeInMainWorld("apprenticeDesktop", {
  resizePill: (height) => ipcRenderer.send("pill:resize", height),
  setPillInteractive: (interactive) => ipcRenderer.send("pill:interactive", interactive),
  pill: (command) => ipcRenderer.send("pill:command", command),
  dragPill: {
    start: () => ipcRenderer.send("pill:drag-start"),
    move: (dx, dy) => ipcRenderer.send("pill:drag", dx, dy),
    end: () => ipcRenderer.send("pill:drag-end"),
    reset: () => ipcRenderer.send("pill:reset-position"),
  },
});
