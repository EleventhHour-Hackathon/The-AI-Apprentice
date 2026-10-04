import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_KEY_HEADER,
  ACCESS_KEY_STORAGE,
  AccessKeyError,
  BACKEND_URL_STORAGE,
  DEFAULT_BACKEND_URL,
  UNAUTHORIZED_EVENT,
  backendFetch,
  backendHeaders,
  backendUrl,
  hasSavedConnection,
  mediaUrl,
  normalizeBackendUrl,
  saveConnection,
} from "./backend";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("backendUrl", () => {
  it("uses the build's default until a URL is saved", () => {
    expect(backendUrl()).toBe(DEFAULT_BACKEND_URL);
    expect(hasSavedConnection()).toBe(false);
  });

  it("prefers the saved URL, without trailing slashes", () => {
    localStorage.setItem(BACKEND_URL_STORAGE, "https://tacit.onrender.com//");
    expect(backendUrl()).toBe("https://tacit.onrender.com");
    expect(hasSavedConnection()).toBe(true);
  });

  it("ignores a blank saved URL", () => {
    localStorage.setItem(BACKEND_URL_STORAGE, "   ");
    expect(backendUrl()).toBe(DEFAULT_BACKEND_URL);
  });
});

describe("normalizeBackendUrl and saveConnection", () => {
  it("adds https:// to a bare host and keeps http for local servers", () => {
    expect(normalizeBackendUrl(" tacit.onrender.com/ ")).toBe("https://tacit.onrender.com");
    expect(normalizeBackendUrl("http://localhost:8000")).toBe("http://localhost:8000");
    expect(normalizeBackendUrl("")).toBe("");
  });

  it("saves both, and an empty key removes the stored one", () => {
    saveConnection("tacit.example.com", " secret ");
    expect(localStorage.getItem(BACKEND_URL_STORAGE)).toBe("https://tacit.example.com");
    expect(localStorage.getItem(ACCESS_KEY_STORAGE)).toBe("secret");
    saveConnection("tacit.example.com", "");
    expect(localStorage.getItem(ACCESS_KEY_STORAGE)).toBeNull();
  });
});

describe("backendHeaders", () => {
  it("adds nothing without a stored key", () => {
    expect(backendHeaders({ "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("adds the stored key to any kind of headers", () => {
    localStorage.setItem(ACCESS_KEY_STORAGE, "k1");
    expect(backendHeaders()).toEqual({ [ACCESS_KEY_HEADER]: "k1" });
    expect(backendHeaders([["x-a", "1"]])).toEqual({ "x-a": "1", [ACCESS_KEY_HEADER]: "k1" });
    expect(backendHeaders(new Headers({ "x-b": "2" }))).toEqual({
      "x-b": "2",
      [ACCESS_KEY_HEADER]: "k1",
    });
  });
});

describe("mediaUrl", () => {
  const clip = "/api/v1/sessions/s1/clip?at=1.00&start=0.00&end=4.00";

  it("is the plain URL without a key", () => {
    expect(mediaUrl(clip)).toBe(`${DEFAULT_BACKEND_URL}${clip}`);
  });

  it("carries the key as a query parameter, escaped", () => {
    localStorage.setItem(ACCESS_KEY_STORAGE, "a&b=c");
    expect(mediaUrl(clip)).toBe(`${DEFAULT_BACKEND_URL}${clip}&key=a%26b%3Dc`);
    expect(mediaUrl("/x")).toBe(`${DEFAULT_BACKEND_URL}/x?key=a%26b%3Dc`);
  });
});

describe("backendFetch", () => {
  it("calls the saved backend with the key and returns the answer", async () => {
    saveConnection("https://tacit.example.com", "k2");
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const r = await backendFetch("/api/v1/work_maps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status).toBe(200);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://tacit.example.com/api/v1/work_maps");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", [ACCESS_KEY_HEADER]: "k2" });
  });

  it("passes other error statuses back to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    expect((await backendFetch("/api/v1/work_maps")).status).toBe(503);
  });

  it("turns a 401 into AccessKeyError and tells the app", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ detail: "x" }, { status: 401 })),
    );
    const heard = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, heard);
    await expect(backendFetch("/api/v1/work_maps")).rejects.toBeInstanceOf(AccessKeyError);
    await expect(backendFetch("/api/v1/work_maps")).rejects.toThrow("Access key missing or wrong");
    window.removeEventListener(UNAUTHORIZED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("lets a network error through for the caller to explain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(backendFetch("/health")).rejects.toBeInstanceOf(TypeError);
  });
});
