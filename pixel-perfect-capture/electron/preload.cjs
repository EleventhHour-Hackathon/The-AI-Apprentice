const { contextBridge, ipcRenderer } = require("electron");

// The small surface the UI uses to talk to the desktop shell (see src/lib/desktop.ts).
contextBridge.exposeInMainWorld("apprenticeDesktop", {
  resizePill: (height) => ipcRenderer.send("pill:resize", height),
  setPillInteractive: (interactive) => ipcRenderer.send("pill:interactive", interactive),
  pill: (command) => ipcRenderer.send("pill:command", command),
});
