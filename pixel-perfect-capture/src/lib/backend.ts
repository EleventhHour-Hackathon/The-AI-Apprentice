// The Tacit backend (core/backend). The desktop app talks to one hosted backend; which one, and
// its access key, are saved on this machine (Connect to Tacit, or Settings > Connection).

/** The build's default backend: VITE_BACKEND_URL, or a backend on this machine. */
export const DEFAULT_BACKEND_URL = trimUrl(
  String(import.meta.env["VITE_BACKEND_URL"] ?? "http://localhost:8000"),
);
export const BACKEND_URL_STORAGE = "tacit:backend-url";
export const ACCESS_KEY_STORAGE = "tacit:access-key";
/** Header the backend checks when it runs with TACIT_ACCESS_KEY set. */
export const ACCESS_KEY_HEADER = "X-Tacit-Key";
/** Sent on window whenever the backend refuses the access key. */
export const UNAUTHORIZED_EVENT = "tacit:unauthorized";
export const ACCESS_KEY_MESSAGE = "Access key missing or wrong";

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function read(key: string): string {
  try {
    return globalThis.localStorage?.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) globalThis.localStorage?.setItem(key, value);
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // Private mode or storage full: the connection lasts until the window closes.
  }
}

/** A URL someone typed, made usable: "tacit.onrender.com" becomes "https://tacit.onrender.com". */
export function normalizeBackendUrl(input: string): string {
  const url = trimUrl(input);
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** The backend this app talks to: the saved one, else the build's default. */
export function backendUrl(): string {
  return trimUrl(read(BACKEND_URL_STORAGE)) || DEFAULT_BACKEND_URL;
}

/** The build's default access key (VITE_ACCESS_KEY), only ever sent to the build's own backend. */
const DEFAULT_ACCESS_KEY = String(import.meta.env["VITE_ACCESS_KEY"] ?? "").trim();

/** The saved key, else the build's default key when talking to the build's default backend. */
export function accessKey(): string {
  const saved = read(ACCESS_KEY_STORAGE);
  if (saved) return saved;
  return backendUrl() === DEFAULT_BACKEND_URL ? DEFAULT_ACCESS_KEY : "";
}

/** Whether a backend URL was saved on this machine (Connect to Tacit has been done). */
export function hasSavedConnection(): boolean {
  return read(BACKEND_URL_STORAGE) !== "";
}

/** Save the backend and its key. A URL equal to the build's default is still saved. */
export function saveConnection(url: string, key: string) {
  write(BACKEND_URL_STORAGE, normalizeBackendUrl(url));
  write(ACCESS_KEY_STORAGE, key.trim());
}

/** The given headers plus the access key, when one is saved. */
export function backendHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> =
    extra instanceof Headers
      ? Object.fromEntries(extra.entries())
      : Array.isArray(extra)
        ? Object.fromEntries(extra)
        : { ...extra };
  const key = accessKey();
  if (key) headers[ACCESS_KEY_HEADER] = key;
  return headers;
}

/** A full backend URL for a path such as "/api/v1/work_maps"; full URLs pass through. */
export function backendPath(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${backendUrl()}${path}`;
}

/**
 * A backend media URL for <video src>, which can't send headers: the access key goes in the
 * `key` query parameter instead. The backend accepts that only on the clip route.
 */
export function mediaUrl(path: string): string {
  const url = backendPath(path);
  const key = accessKey();
  if (!key) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
}

/** The backend refused the access key (401). */
export class AccessKeyError extends Error {
  constructor() {
    super(`${ACCESS_KEY_MESSAGE}. Check Connection in Settings.`);
    this.name = "AccessKeyError";
  }
}

/** Tell the app the key was refused, so it can point to Connection (see ConnectionGuard). */
export function reportUnauthorized() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

/**
 * fetch() against the backend, with the access key. A 401 throws AccessKeyError (and tells the
 * app); every other answer comes back as is, for the caller to read.
 */
export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(backendPath(path), {
    ...init,
    headers: backendHeaders(init.headers),
  });
  if (response.status === 401) {
    reportUnauthorized();
    throw new AccessKeyError();
  }
  return response;
}
