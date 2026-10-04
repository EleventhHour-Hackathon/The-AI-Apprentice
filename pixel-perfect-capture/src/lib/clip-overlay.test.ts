import { describe, expect, it } from "vitest";
import {
  defaultOverlayWidth,
  maxOverlayWidth,
  OVERLAY_SIZE_KEY,
  overlaySize,
  storedOverlayWidth,
  storeOverlayWidth,
} from "./clip-overlay";

const wide = { width: 1600, height: 900 };

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

describe("overlaySize", () => {
  it("keeps 16:9", () => {
    expect(overlaySize(960, wide)).toEqual({ width: 960, height: 540 });
  });

  it("never goes below 480x270", () => {
    expect(overlaySize(100, wide)).toEqual({ width: 480, height: 270 });
  });

  it("never goes beyond the window, height included", () => {
    // 900 high leaves 852, so at most 1514 wide.
    expect(maxOverlayWidth(wide)).toBe(1514);
    expect(overlaySize(5000, wide)).toEqual({ width: 1514, height: 852 });
    expect(overlaySize(5000, { width: 800, height: 2000 }).width).toBe(752);
  });

  it("fits a window smaller than the minimum", () => {
    expect(overlaySize(480, { width: 400, height: 300 }).width).toBe(352);
  });

  it("falls back to the largest size for a bad width", () => {
    expect(overlaySize(Number.NaN, wide).width).toBe(1514);
  });

  it("opens at 80% of the window", () => {
    expect(defaultOverlayWidth(wide)).toBe(1280);
    expect(defaultOverlayWidth({ width: 2000, height: 600 })).toBeCloseTo(853.33, 1);
  });
});

describe("stored width", () => {
  it("round-trips", () => {
    const store = fakeStorage();
    storeOverlayWidth(1023.6, store);
    expect(store.items.get(OVERLAY_SIZE_KEY)).toBe("1024");
    expect(storedOverlayWidth(store)).toBe(1024);
  });

  it("ignores missing or bad values", () => {
    expect(storedOverlayWidth(fakeStorage())).toBeNull();
    expect(storedOverlayWidth(fakeStorage({ [OVERLAY_SIZE_KEY]: "wide" }))).toBeNull();
    expect(storedOverlayWidth(undefined)).toBeNull();
  });

  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(storedOverlayWidth(broken)).toBeNull();
    expect(() => storeOverlayWidth(600, broken)).not.toThrow();
  });
});
