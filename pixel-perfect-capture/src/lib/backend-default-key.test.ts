import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The build-time key is read once when lib/backend loads, so each case loads it fresh.
async function load() {
  vi.resetModules();
  return import("./backend");
}

describe("the build's default access key", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_BACKEND_URL", "https://tacit.example.com");
    vi.stubEnv("VITE_ACCESS_KEY", "build-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("is sent to the build's own backend when nothing is saved", async () => {
    const b = await load();
    expect(b.accessKey()).toBe("build-key");
    expect(b.backendHeaders()[b.ACCESS_KEY_HEADER]).toBe("build-key");
  });

  it("gives way to a key saved on this machine", async () => {
    const b = await load();
    b.saveConnection("https://tacit.example.com", "saved-key");
    expect(b.accessKey()).toBe("saved-key");
  });

  it("is never sent to a different backend", async () => {
    const b = await load();
    localStorage.setItem(b.BACKEND_URL_STORAGE, "https://elsewhere.example.com");
    expect(b.accessKey()).toBe("");
    expect(b.backendHeaders()[b.ACCESS_KEY_HEADER]).toBeUndefined();
  });

  it("is empty when the build has none", async () => {
    vi.stubEnv("VITE_ACCESS_KEY", "");
    const b = await load();
    expect(b.accessKey()).toBe("");
  });
});
