// Bridge to the Electron shell (electron/preload.cjs). Undefined in a plain browser.
type DesktopBridge = {
  resizePill: (height: number) => void;
  setPillInteractive: (interactive: boolean) => void;
  pill: (command: "show" | "hide" | "start" | "app" | "pill-only") => void;
};

export const desktop = (): DesktopBridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as Window & { apprenticeDesktop?: DesktopBridge }).apprenticeDesktop;
