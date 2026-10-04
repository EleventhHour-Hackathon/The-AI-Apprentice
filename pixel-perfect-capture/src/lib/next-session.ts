/**
 * "Record again" on a Work Map: the next session the expert starts is linked to that map, so its
 * debrief asks first the questions kept for them there. The link waits in localStorage (shared by
 * the Studio page and the Electron pill) until a session connects with it.
 */

export const NEXT_SESSION_KEY = "tacit:next-session";
/** An abandoned "Record again" must not link a session started much later. */
export const NEXT_SESSION_TTL_MS = 10 * 60 * 1000;

const local = (): Storage | undefined =>
  typeof localStorage === "undefined" ? undefined : localStorage;

/** Link the next session to this Work Map. */
export function saveNextSession(
  parentId: string,
  now = Date.now(),
  storage: Pick<Storage, "setItem"> | undefined = local(),
): void {
  try {
    storage?.setItem(
      NEXT_SESSION_KEY,
      JSON.stringify({ parent_work_map_id: parentId, expires_at: now + NEXT_SESSION_TTL_MS }),
    );
  } catch {
    // No localStorage or it's full: the next session is recorded as a new one.
  }
}

/**
 * The Work Map the session starting now is recorded again from, if any. The link stays until
 * `clearNextSession`, so a start that fails (no token, mic denied) can be retried; only a link
 * that is malformed or expired is removed here.
 */
export function peekNextSession(
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "removeItem"> | undefined = local(),
): string | null {
  try {
    const raw = storage?.getItem(NEXT_SESSION_KEY);
    if (!storage || raw == null) return null;
    let v: unknown = null;
    try {
      v = JSON.parse(raw);
    } catch {
      // Not JSON: dropped below.
    }
    const { parent_work_map_id: id, expires_at: expires } =
      typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
    if (typeof id === "string" && id && typeof expires === "number" && expires > now) return id;
    storage.removeItem(NEXT_SESSION_KEY);
    return null;
  } catch {
    return null;
  }
}

/** The session connected with the link (or the backend refused it): it is used up. */
export function clearNextSession(storage: Pick<Storage, "removeItem"> | undefined = local()): void {
  try {
    storage?.removeItem(NEXT_SESSION_KEY);
  } catch {
    // No localStorage: nothing to clear.
  }
}

/** A backend call that answered with an error status. */
export class PostError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PostError";
    this.status = status;
  }
}

/** The backend refused the parent (404 unknown map, 422 the session itself): start without it. */
export const parentRefused = (error: unknown): boolean =>
  error instanceof PostError && (error.status === 404 || error.status === 422);
