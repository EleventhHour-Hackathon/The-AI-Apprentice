// Bridge to the Electron shell (electron/preload.cjs). Undefined in a plain browser.
type DesktopBridge = {
  resizePill: (height: number) => void;
  setPillInteractive: (interactive: boolean) => void;
  /** Move the floating pill window; dx/dy are screen points since start(). */
  dragPill?: {
    start: () => void;
    move: (dx: number, dy: number) => void;
    end: () => void;
    reset: () => void;
  };
  pill: (
    command:
      "show" | "hide" | "start" | "app" | "pill-only" | `lesson:${string}` | `open:/${string}`,
  ) => void;
};

export const desktop = (): DesktopBridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as Window & { apprenticeDesktop?: DesktopBridge }).apprenticeDesktop;
