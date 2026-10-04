import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BACKEND_URL as BACKEND_URL } from "./backend";
import {
  DIAGNOSTIC_TIMEOUT_MS,
  defaultSettings,
  loadSettings,
  resetSettings,
  runDiagnostics,
  saveSetting,
  saveSettings,
} from "./settings";

const KEY = "tacit:settings";

describe("settings storage", () => {
  beforeEach(() => localStorage.clear());

  it("starts at the defaults the page showed", () => {
    const s = loadSettings();
    expect(s).toEqual(defaultSettings());
    expect(s.voice).toBe("ivy");
    expect(s.tutorVoice).toBe("theo");
    expect(s.curiosity).toBe("balanced");
    expect(s.minQuestions).toBe("3");
    expect(s.speakingSpeed).toBe(100);
    expect(s.captions).toBe(true);
    expect(s.expertReview).toBe(false);
    expect(s.vocabulary).toEqual(["GL code", "3-way match", "Net 30"]);
    expect(s.appearance).toBe("system");
  });

  it("doesn't keep the language, which lib/languages.ts owns", () => {
    expect("language" in loadSettings()).toBe(false);
  });

  it("round-trips saved choices", () => {
    saveSetting("voice", "mara");
    saveSettings({ speakingSpeed: 115, captions: false, excludedApps: ["Slack"] });
    const s = loadSettings();
    expect(s.voice).toBe("mara");
    expect(s.speakingSpeed).toBe(115);
    expect(s.captions).toBe(false);
    expect(s.excludedApps).toEqual(["Slack"]);
    expect(s.debriefDepth).toBe("standard");
  });

  it("returns the settings as stored after a save", () => {
    expect(saveSetting("appearance", "dark").appearance).toBe("dark");
  });

  it("falls back to the defaults on bad JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadSettings()).toEqual(defaultSettings());
    localStorage.setItem(KEY, JSON.stringify(["an", "array"]));
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it("drops unknown keys and values of the wrong type or out of range", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        voice: "robot",
        speakingSpeed: 300,
        captions: "yes",
        vocabulary: [1, 2],
        minQuestions: 3,
        curiosity: "curious",
        evil: true,
      }),
    );
    const s = loadSettings();
    expect(s.voice).toBe("ivy");
    expect(s.speakingSpeed).toBe(100);
    expect(s.captions).toBe(true);
    expect(s.vocabulary).toEqual(["GL code", "3-way match", "Net 30"]);
    expect(s.minQuestions).toBe("3");
    expect(s.curiosity).toBe("curious");
    expect("evil" in s).toBe(false);
  });

  it("moves a stored minimum of 2 questions up to 3, and keeps 4", () => {
    localStorage.setItem(KEY, JSON.stringify({ minQuestions: "2" }));
    expect(loadSettings().minQuestions).toBe("3");
    saveSettings({ minQuestions: "4" });
    expect(loadSettings().minQuestions).toBe("4");
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").minQuestions).toBe("4");
  });

  it("rejects a speed off the slider's steps", () => {
    localStorage.setItem(KEY, JSON.stringify({ speakingSpeed: 102 }));
    expect(loadSettings().speakingSpeed).toBe(100);
  });

  it("doesn't save invalid values", () => {
    saveSettings({ speakingSpeed: 999 });
    expect(loadSettings().speakingSpeed).toBe(100);
  });

  it("resets to the defaults", () => {
    saveSettings({ voice: "theo", soundCues: false });
    expect(resetSettings()).toEqual(defaultSettings());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it("keeps the defaults unchanged when a returned list is changed", () => {
    loadSettings().vocabulary.push("oops");
    expect(defaultSettings().vocabulary).not.toContain("oops");
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Routes = Record<string, () => Promise<Response>>;
const HEALTHY: Routes = {
  "/health": async () =>
    json({ message: "ok", version: "2.0.0", privacy: { names: true, engine: "presidio" } }),
  "/api/v1/work_maps": async () => json([]),
  "/api/v1/agent/token?role=apprentice": async () => json({ token: "secret-a" }),
  "/api/v1/agent/token?role=tutor": async () => json({ token: "secret-t" }),
};

function fakeFetch(overrides: Routes = {}) {
  const routes = { ...HEALTHY, ...overrides };
  return vi.fn((url: string | URL | Request) => {
    const path = String(url).slice(BACKEND_URL.length);
    const route = routes[path];
    if (!route) throw new Error(`unexpected ${path}`);
    return route();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const byId = (results: Awaited<ReturnType<typeof runDiagnostics>>) =>
  Object.fromEntries(results.map((r) => [r.id, r]));

describe("runDiagnostics", () => {
  afterEach(() => vi.useRealTimers());

  it("reports every check OK when all is healthy, without keeping the token", async () => {
    const fetchFn = fakeFetch();
    const results = await runDiagnostics(fetchFn);
    expect(results.map((r) => r.id)).toEqual([
      "backend",
      "redaction",
      "storage",
      "apprentice-agent",
      "tutor-agent",
    ]);
    expect(results.every((r) => r.ok === true)).toBe(true);
    const r = byId(results);
    expect(r["backend"]?.detail).toContain("v2.0.0");
    expect(r["redaction"]?.detail).toBe("Presidio");
    expect(JSON.stringify(results)).not.toContain("secret");
  });

  it("flags regex-only redaction", async () => {
    const r = byId(
      await runDiagnostics(
        fakeFetch({
          "/health": async () =>
            json({ version: "2.0.0", privacy: { names: false, engine: "regex" } }),
        }),
      ),
    );
    expect(r["redaction"]).toMatchObject({
      ok: false,
      detail: "Regex only: names aren't redacted",
    });
    expect(r["backend"]?.ok).toBe(true);
  });

  it("flags storage when the store answers 503", async () => {
    const r = byId(
      await runDiagnostics(
        fakeFetch({
          "/api/v1/work_maps": async () => json({ detail: "Work Map storage is unavailable" }, 503),
        }),
      ),
    );
    expect(r["storage"]).toMatchObject({ ok: false, detail: "Storage unavailable" });
    expect(r["apprentice-agent"]?.ok).toBe(true);
  });

  it("uses the backend's detail when an agent is unreachable", async () => {
    const r = byId(
      await runDiagnostics(
        fakeFetch({
          "/api/v1/agent/token?role=tutor": async () =>
            json({ detail: "Couldn't reach the ElevenLabs agent" }, 502),
        }),
      ),
    );
    expect(r["tutor-agent"]).toMatchObject({
      ok: false,
      detail: "Couldn't reach the ElevenLabs agent",
    });
    expect(r["apprentice-agent"]?.ok).toBe(true);
  });

  it("skips the dependent checks when the backend is down", async () => {
    const fetchFn = fakeFetch({
      "/health": () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const results = await runDiagnostics(fetchFn);
    expect(results[0]).toMatchObject({ id: "backend", ok: false });
    expect(results[0]?.detail).toMatch(/^Can't reach /);
    expect(results.slice(1).every((r) => r.ok === null)).toBe(true);
    expect(results[1]?.detail).toBe("Not checked: backend is down");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("times out a request that never answers", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const pending = runDiagnostics(fetchFn);
    await vi.advanceTimersByTimeAsync(DIAGNOSTIC_TIMEOUT_MS);
    const results = await pending;
    expect(results[0]).toMatchObject({ id: "backend", ok: false, detail: "No answer after 5 s" });
    expect(signal?.aborted).toBe(true);
    expect(results.slice(1).every((r) => r.ok === null)).toBe(true);
  });

  it("times out one hung check without holding up the rest", async () => {
    vi.useFakeTimers();
    const pending = runDiagnostics(
      fakeFetch({ "/api/v1/agent/token?role=apprentice": () => new Promise(() => undefined) }),
    );
    await vi.advanceTimersByTimeAsync(DIAGNOSTIC_TIMEOUT_MS);
    const r = byId(await pending);
    expect(r["apprentice-agent"]).toMatchObject({ ok: false, detail: "No answer after 5 s" });
    expect(r["storage"]?.ok).toBe(true);
  });

  it("never throws, even when fetch throws synchronously", async () => {
    const fetchFn = (() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(runDiagnostics(fetchFn)).resolves.toHaveLength(5);
  });
});
