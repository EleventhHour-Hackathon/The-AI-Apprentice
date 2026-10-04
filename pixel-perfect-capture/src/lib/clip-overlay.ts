/**
 * The size of the enlarged clip player: 16:9, at least 480x270, never bigger than the window,
 * and the last size the user dragged it to, remembered across clips.
 */

export const OVERLAY_RATIO = 16 / 9;
export const OVERLAY_MIN_WIDTH = 480;
/** Space kept clear around the overlay, so the backdrop stays clickable. */
export const OVERLAY_MARGIN = 24;
export const OVERLAY_SIZE_KEY = "tacit:clip-overlay-width";

type Viewport = { width: number; height: number };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The widest the overlay can be in this window. */
export function maxOverlayWidth(viewport: Viewport) {
  const room = Math.min(
    viewport.width - OVERLAY_MARGIN * 2,
    (viewport.height - OVERLAY_MARGIN * 2) * OVERLAY_RATIO,
  );
  return Math.max(Math.floor(room), 0);
}

/** Clamp a width to the limits and give the 16:9 size. A window smaller than the minimum wins. */
export function overlaySize(width: number, viewport: Viewport) {
  const max = maxOverlayWidth(viewport);
  const w = Math.round(
    Math.min(Math.max(Number.isFinite(width) ? width : max, OVERLAY_MIN_WIDTH), max),
  );
  return { width: w, height: Math.round(w / OVERLAY_RATIO) };
}

/** First open: 80% of the window. */
export const defaultOverlayWidth = (viewport: Viewport) =>
  Math.min(viewport.width * 0.8, viewport.height * 0.8 * OVERLAY_RATIO);

const storage = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

export function storedOverlayWidth(store: Storage | undefined = storage()): number | null {
  try {
    const n = Number(store?.getItem(OVERLAY_SIZE_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function storeOverlayWidth(width: number, store: Storage | undefined = storage()) {
  try {
    store?.setItem(OVERLAY_SIZE_KEY, String(Math.round(width)));
  } catch {
    // No localStorage or it's full: the next clip opens at the default size.
  }
}
