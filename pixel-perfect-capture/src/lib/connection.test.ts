import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_KEY_HEADER, saveConnection } from "./backend";
import { launchState, testConnection } from "./connection";

const URL = "https://tacit.example.com";

/** A fake backend: /health says whether it wants a key, and only `key` passes the check. */
function server({ access = "key", key = "right" }: { access?: "key" | "open"; key?: string } = {}) {
  return vi.fn((url: string, init?: RequestInit) => {
    const sent = (init?.headers as Record<string, string> | undefined)?.[ACCESS_KEY_HEADER];
    if (url.endsWith("/health")) return Promise.resolve(Response.json({ status: "ok", access }));
    if (access === "key" && sent !== key)
      return Promise.resolve(
        Response.json({ detail: "Missing or wrong access key" }, { status: 401 }),
      );
    return Promise.resolve(Response.json([]));
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

beforeEach(() => localStorage.clear());

describe("testConnection", () => {
  it("connects with the right key, checking health then an authenticated call", async () => {
    const fetchFn = server();
    expect(await testConnection("tacit.example.com/", "right", { fetchFn })).toEqual({
      ok: true,
      url: URL,
      access: "key",
    });
    expect(fetchFn.mock.calls.map(([u]) => u)).toEqual([
      `${URL}/health`,
      `${URL}/api/v1/work_maps`,
    ]);
  });

  it("asks for a key the server needs, and says when it is wrong", async () => {
    expect(await testConnection(URL, "", { fetchFn: server() })).toMatchObject({
      ok: false,
      field: "key",
      message: "This server needs an access key.",
    });
    expect(await testConnection(URL, "wrong", { fetchFn: server() })).toMatchObject({
      ok: false,
      field: "key",
      message: "Access key missing or wrong.",
    });
  });

  it("connects to an open server without a key, with one call", async () => {
    const fetchFn = server({ access: "open" });
    expect(await testConnection("http://localhost:8000", "", { fetchFn })).toEqual({
      ok: true,
      url: "http://localhost:8000",
      access: "open",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("explains an empty, unreachable or wrong address", async () => {
    expect(await testConnection(" ", "", { fetchFn: server() })).toMatchObject({ field: "url" });
    const down = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await testConnection(URL, "", { fetchFn: down })).toMatchObject({
      ok: false,
      field: "url",
      message: expect.stringContaining("Can’t reach tacit.example.com"),
    });
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await testConnection(URL, "", { fetchFn: html })).toMatchObject({
      field: "url",
      message: expect.stringContaining("Is this a Tacit server?"),
    });
  });

  it("gives up after the timeout", async () => {
    const hang = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError"))),
        ),
    ) as unknown as typeof fetch;
    expect(await testConnection(URL, "", { fetchFn: hang, timeoutMs: 10 })).toMatchObject({
      field: "url",
      message: expect.stringContaining("No answer"),
    });
  });
});

describe("launchState", () => {
  const down = vi
    .fn()
    .mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;

  it("is ok with a working saved connection", async () => {
    saveConnection(URL, "right");
    expect(await launchState({ fetchFn: server() })).toBe("ok");
  });

  it("goes to Connect on a first launch without a reachable backend", async () => {
    expect(await launchState({ fetchFn: down })).toBe("connect");
  });

  it("only notes a saved backend that doesn't answer right now", async () => {
    saveConnection(URL, "right");
    expect(await launchState({ fetchFn: down })).toBe("unreachable");
  });

  it("goes to Connect when the key is missing or refused", async () => {
    saveConnection(URL, "");
    expect(await launchState({ fetchFn: server() })).toBe("connect");
    saveConnection(URL, "old");
    expect(await launchState({ fetchFn: server() })).toBe("connect");
  });
});
