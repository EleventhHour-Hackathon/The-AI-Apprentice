/**
 * Whether this app can talk to its Tacit backend: the checks behind Connect to Tacit
 * (routes/connect.tsx), Settings > Connection and the check on launch (ConnectionGuard).
 */
import {
  ACCESS_KEY_HEADER,
  ACCESS_KEY_MESSAGE,
  accessKey,
  backendUrl,
  hasSavedConnection,
  normalizeBackendUrl,
} from "./backend";

/** A backend that has been asleep (Render's free plan) can take most of a minute to wake. */
export const CONNECT_TIMEOUT_MS = 60_000;
/** The check on launch gives up sooner and lets the person decide on the Connect screen. */
export const LAUNCH_TIMEOUT_MS = 20_000;

export type ConnectResult =
  | { ok: true; url: string; access: "key" | "open" }
  | { ok: false; field: "url" | "key"; message: string };

type Answer = { status: number; body: unknown } | { error: "unreachable" | "timeout" };

/** One GET with a timeout. Never throws. */
async function get(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { headers, signal: controller.signal, cache: "no-store" });
    const body: unknown = await r.json().catch(() => null);
    return { status: r.status, body };
  } catch {
    return { error: controller.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

const host = (url: string) => url.replace(/^https?:\/\//i, "");
const accessOf = (body: unknown): "key" | "open" =>
  body && typeof body === "object" && (body as Record<string, unknown>)["access"] === "key"
    ? "key"
    : "open";

/**
 * Check a backend URL and access key: GET /health without the key, then (when the backend asks
 * for one, or one was given) an authenticated call. Anything but a 401 there means the key works.
 */
export async function testConnection(
  rawUrl: string,
  rawKey: string,
  { fetchFn = fetch, timeoutMs = CONNECT_TIMEOUT_MS } = {},
): Promise<ConnectResult> {
  const url = normalizeBackendUrl(rawUrl);
  const key = rawKey.trim();
  if (!url) return { ok: false, field: "url", message: "Enter the server address." };
  if (!/^https?:\/\/[^\s/]+/i.test(url))
    return { ok: false, field: "url", message: "That doesn’t look like a web address." };

  const health = await get(fetchFn, `${url}/health`, {}, timeoutMs);
  if ("error" in health)
    return {
      ok: false,
      field: "url",
      message:
        health.error === "timeout"
          ? `No answer from ${host(url)} after ${Math.round(timeoutMs / 1000)} s. Try again in a moment.`
          : `Can’t reach ${host(url)}. Check the address and your internet connection.`,
    };
  if (health.status < 200 || health.status >= 300 || !health.body)
    return {
      ok: false,
      field: "url",
      message: `${host(url)} answered ${health.status}. Is this a Tacit server?`,
    };

  const access = accessOf(health.body);
  if (access === "key" && !key)
    return { ok: false, field: "key", message: "This server needs an access key." };
  if (access === "open" && !key) return { ok: true, url, access };

  const check = await get(
    fetchFn,
    `${url}/api/v1/work_maps`,
    { [ACCESS_KEY_HEADER]: key },
    timeoutMs,
  );
  if ("error" in check)
    return { ok: false, field: "url", message: `Can’t reach ${host(url)} with the key.` };
  if (check.status === 401) return { ok: false, field: "key", message: `${ACCESS_KEY_MESSAGE}.` };
  return { ok: true, url, access };
}

/** What the check on launch found: fine, send the person to Connect, or the server is away. */
export type LaunchState = "ok" | "connect" | "unreachable";

/**
 * The check on launch. A first launch with no reachable backend, or a backend that wants a key
 * this app doesn't have (or refuses it), goes to Connect. A saved backend that doesn't answer
 * right now is only "unreachable": the person keeps their place and sees a note.
 */
export async function launchState({
  fetchFn = fetch,
  timeoutMs = LAUNCH_TIMEOUT_MS,
} = {}): Promise<LaunchState> {
  const result = await testConnection(backendUrl(), accessKey(), { fetchFn, timeoutMs });
  if (result.ok) return "ok";
  if (result.field === "key") return "connect";
  return hasSavedConnection() ? "unreachable" : "connect";
}
