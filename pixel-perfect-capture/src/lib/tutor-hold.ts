/**
 * What the tutor's pill tells the practice ERP (another window of the same origin) so a wrong
 * decision is caught before it is saved:
 *
 * - "watching": a lesson is live, so a confirm waits for the tutor's look first (with `off`:
 *   the lesson ended, stop waiting);
 * - "checked": the tutor has checked a screen frame captured at `seen`;
 * - "hold": the tutor flagged a wrong decision; the save buttons lock until it's fixed.
 *
 * The pill re-sends "watching" (and any hold) every HEARTBEAT_MS; both lapse after HOLD_TTL_MS
 * without a refresh, so a closed or crashed pill can't lock the ERP for good.
 */

export const CHANNEL = "tacit-tutor";
export const HOLD_TTL_MS = 15_000;
export const HEARTBEAT_MS = 5_000;
/** A confirm waits at most this long for the tutor's check, then saves anyway. */
export const CONFIRM_WAIT_MS = 8_000;
/**
 * How far the pill's copy of the screen can trail the real one (the privacy shield redraws at
 * 10 fps, then captureStream and a second video element): a frame stamped within this much of
 * the dialog opening may still show the screen before it.
 */
export const FRAME_LAG_MS = 500;

export type HoldFlag = { step: string; what_happened: string };
export type HoldMessage = { type: "hold"; flags: HoldFlag[]; at: number };
export type WatchingMessage = { type: "watching"; at: number; off?: true };
export type CheckedMessage = { type: "checked"; seen: number; at: number };
export type TutorMessage = HoldMessage | WatchingMessage | CheckedMessage;

type Channel = Pick<BroadcastChannel, "postMessage" | "close"> & {
  onmessage: ((e: MessageEvent) => void) | null;
};
type ChannelCtor = new (name: string) => Channel;

const defaultCtor = (): ChannelCtor | null =>
  typeof BroadcastChannel === "undefined" ? null : (BroadcastChannel as unknown as ChannelCtor);

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A tutor message, or null if `data` isn't one. */
export function parseHold(data: unknown): TutorMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    type?: unknown;
    at?: unknown;
    seen?: unknown;
    flags?: unknown;
    off?: unknown;
  };
  if (!isTime(d.at)) return null;
  if (d.type === "watching")
    return d.off === true
      ? { type: "watching", at: d.at, off: true }
      : { type: "watching", at: d.at };
  if (d.type === "checked")
    return isTime(d.seen) ? { type: "checked", seen: d.seen, at: d.at } : null;
  if (d.type !== "hold" || !Array.isArray(d.flags)) return null;
  const flags: HoldFlag[] = [];
  for (const f of d.flags) {
    if (!f || typeof f !== "object") return null;
    const { step, what_happened } = f as Record<string, unknown>;
    if (typeof step !== "string" || typeof what_happened !== "string") return null;
    flags.push({ step, what_happened });
  }
  return { type: "hold", flags, at: d.at };
}

/** True while the last hold has open flags and hasn't lapsed. */
export function isHeld(last: HoldMessage | null, now: number): boolean {
  return !!last && last.flags.length > 0 && now - last.at < HOLD_TTL_MS;
}

/** True while a live lesson's heartbeat is fresh. */
export function isWatching(watchingAt: number | null, now: number): boolean {
  return watchingAt !== null && now - watchingAt < HOLD_TTL_MS;
}

/** What the practice ERP knows from the pill. */
export type TutorSignals = {
  last: HoldMessage | null;
  /** The latest heartbeat of a live lesson; null once it ended. */
  watchingAt: number | null;
  /** Capture time of the newest frame the tutor has checked. */
  checkedSeen: number | null;
};
export const NO_SIGNALS: TutorSignals = { last: null, watchingAt: null, checkedSeen: null };

/** Fold one message into what the practice ERP knows. */
export function applyMessage(s: TutorSignals, m: TutorMessage): TutorSignals {
  if (m.type === "hold") return { ...s, last: m };
  if (m.type === "watching") return { ...s, watchingAt: m.off ? null : m.at };
  return { ...s, checkedSeen: Math.max(s.checkedSeen ?? m.seen, m.seen) };
}

export type ConfirmInput = TutorSignals & {
  now: number;
  /** When the confirm dialog opened, and when its confirm button was pressed. */
  openedAt: number;
  confirmedAt: number;
};

/**
 * What a pressed confirm should do: "held" (the tutor stepped in, lock), "save", or "wait" for
 * the tutor to check a frame captured after the dialog opened. With no live tutor it saves at
 * once; it never waits longer than CONFIRM_WAIT_MS.
 */
export function decideConfirm(i: ConfirmInput): "held" | "save" | "wait" {
  if (isHeld(i.last, i.now)) return "held";
  if (!isWatching(i.watchingAt, i.now)) return "save";
  if (i.checkedSeen !== null && i.checkedSeen > i.openedAt + FRAME_LAG_MS) return "save";
  if (i.now - i.confirmedAt >= CONFIRM_WAIT_MS) return "save";
  return "wait";
}

function publish(message: TutorMessage, Ctor: ChannelCtor | null) {
  if (!Ctor) return;
  try {
    const c = new Ctor(CHANNEL);
    c.postMessage(message);
    c.close();
  } catch (e) {
    console.warn("[tutor-hold] publish failed", e);
  }
}

/** Tell every window of this origin which flags are open (an empty list releases the hold). */
export function publishHold(flags: HoldFlag[], Ctor: ChannelCtor | null = defaultCtor()) {
  const copy = flags.map(({ step, what_happened }) => ({ step, what_happened }));
  publish({ type: "hold", flags: copy, at: Date.now() }, Ctor);
}

/** A lesson is live (or, with `off`, ended): confirms in the practice ERP wait for its check. */
export function publishWatching(off = false, Ctor: ChannelCtor | null = defaultCtor()) {
  const at = Date.now();
  publish(off ? { type: "watching", at, off: true } : { type: "watching", at }, Ctor);
}

/** The tutor has checked a screen frame captured at `seen` (Date.now()). */
export function publishChecked(seen: number, Ctor: ChannelCtor | null = defaultCtor()) {
  publish({ type: "checked", seen, at: Date.now() }, Ctor);
}

/** Listen for tutor messages; returns the unsubscribe. */
export function subscribeHold(
  cb: (message: TutorMessage) => void,
  Ctor: ChannelCtor | null = defaultCtor(),
): () => void {
  if (!Ctor) return () => undefined;
  const c = new Ctor(CHANNEL);
  c.onmessage = (e) => {
    const message = parseHold(e.data);
    if (message) cb(message);
  };
  return () => {
    c.onmessage = null;
    c.close();
  };
}
