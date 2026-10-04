import { describe, expect, it } from "vitest";
import {
  clearNextSession,
  NEXT_SESSION_KEY,
  NEXT_SESSION_TTL_MS,
  parentRefused,
  peekNextSession,
  PostError,
  saveNextSession,
} from "./next-session";

const ID = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b";
const T0 = 1_760_000_000_000;

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe("next session", () => {
  it("expires after 10 minutes", () => {
    expect(NEXT_SESSION_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("saves the parent and an expiry", () => {
    const storage = fakeStorage();
    saveNextSession(ID, T0, storage);
    expect(JSON.parse(storage.items.get(NEXT_SESSION_KEY)!)).toEqual({
      parent_work_map_id: ID,
      expires_at: T0 + NEXT_SESSION_TTL_MS,
    });
  });

  it("stays until cleared, so a failed start can be retried", () => {
    const storage = fakeStorage();
    saveNextSession(ID, T0, storage);
    expect(peekNextSession(T0 + 1000, storage)).toBe(ID);
    expect(peekNextSession(T0 + 2000, storage)).toBe(ID);
    clearNextSession(storage);
    expect(peekNextSession(T0 + 3000, storage)).toBeNull();
    expect(storage.items.has(NEXT_SESSION_KEY)).toBe(false);
  });

  it("is still there just before it expires and removed at expiry", () => {
    const storage = fakeStorage();
    saveNextSession(ID, T0, storage);
    expect(peekNextSession(T0 + NEXT_SESSION_TTL_MS - 1, storage)).toBe(ID);
    expect(storage.items.has(NEXT_SESSION_KEY)).toBe(true);
    expect(peekNextSession(T0 + NEXT_SESSION_TTL_MS, storage)).toBeNull();
    expect(storage.items.has(NEXT_SESSION_KEY)).toBe(false);
  });

  it("is not used an hour later, and is removed", () => {
    const storage = fakeStorage();
    saveNextSession(ID, T0, storage);
    expect(peekNextSession(T0 + 60 * 60 * 1000, storage)).toBeNull();
    expect(storage.items.has(NEXT_SESSION_KEY)).toBe(false);
  });

  it.each([
    "not json",
    "null",
    "42",
    '"x"',
    "[]",
    JSON.stringify({ parent_work_map_id: "", expires_at: T0 + 1000 }),
    JSON.stringify({ parent_work_map_id: 7, expires_at: T0 + 1000 }),
    JSON.stringify({ parent_work_map_id: ID, expires_at: String(T0 + 1000) }),
    JSON.stringify({ parent_work_map_id: ID }),
  ])("ignores %s and removes it", (raw) => {
    const storage = fakeStorage({ [NEXT_SESSION_KEY]: raw });
    expect(peekNextSession(T0, storage)).toBeNull();
    expect(storage.items.has(NEXT_SESSION_KEY)).toBe(false);
  });

  it("returns null when nothing was saved", () => {
    expect(peekNextSession(T0, fakeStorage())).toBeNull();
  });

  it("returns null when storage throws, and saving or clearing doesn't throw", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(peekNextSession(T0, broken)).toBeNull();
    expect(() => saveNextSession(ID, T0, broken)).not.toThrow();
    expect(() => clearNextSession(broken)).not.toThrow();
  });

  it("knows when the backend refused the parent", () => {
    const path = `/sessions/${ID}/start`;
    const error = new PostError(`${path} answered 404`, 404);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(`${path} answered 404`);
    expect(parentRefused(error)).toBe(true);
    expect(parentRefused(new PostError(`${path} answered 422`, 422))).toBe(true);
    expect(parentRefused(new PostError(`${path} answered 503`, 503))).toBe(false);
    expect(parentRefused(new Error(`${path} answered 404`))).toBe(false);
    expect(parentRefused(new TypeError("Failed to fetch"))).toBe(false);
  });
});
