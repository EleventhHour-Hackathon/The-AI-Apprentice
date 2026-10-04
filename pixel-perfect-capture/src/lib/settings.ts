/**
 * The Settings page: the choices it shows, saved on this machine (tacit:settings in localStorage),
 * and the Diagnostics checks against the backend.
 *
 * The apprentice language lives in lib/languages.ts (tacit:language:<role>), not here.
 */
import { useCallback, useEffect, useState } from "react";
import { ACCESS_KEY_MESSAGE, backendHeaders, backendPath, backendUrl } from "./backend";

const KEY = "tacit:settings";

type Field<T> = { fallback: T; valid: (v: unknown) => v is T };

const oneOf = <const T extends string>(values: readonly T[], fallback: NoInfer<T>): Field<T> => ({
  fallback,
  valid: (v): v is T => values.includes(v as T),
});
const flag = (fallback: boolean): Field<boolean> => ({
  fallback,
  valid: (v): v is boolean => typeof v === "boolean",
});
const range = (min: number, max: number, step: number, fallback: number): Field<number> => ({
  fallback,
  valid: (v): v is number =>
    typeof v === "number" && v >= min && v <= max && Number.isInteger((v - min) / step),
});
// Chips such as domain terms: a short list of short, non-empty strings.
const list = (fallback: string[]): Field<string[]> => ({
  fallback,
  valid: (v): v is string[] =>
    Array.isArray(v) &&
    v.length <= 50 &&
    v.every((s) => typeof s === "string" && s.trim() !== "" && s.length <= 60),
});

const VOICES = ["ivy", "theo", "mara"] as const;

// Every preference on the page, with the value it starts at.
const SPEC = {
  // Apprentice
  voice: oneOf(VOICES, "ivy"),
  curiosity: oneOf(["quiet", "balanced", "curious"], "balanced"),
  minQuestions: oneOf(["3", "4", "5"], "3"),
  speakingSpeed: range(75, 125, 5, 100),
  debriefDepth: oneOf(["short", "standard", "thorough"], "standard"),
  vocabulary: list(["GL code", "3-way match", "Net 30"]),
  captions: flag(true),
  // Capture
  watch: oneOf(["screen", "window", "ask"], "screen"),
  recordVideo: flag(true),
  videoQuality: oneOf(["720p", "1080p", "native"], "native"),
  screenInterval: oneOf(["2", "5", "10"], "5"),
  blurSensitive: flag(true),
  excludedApps: list(["1Password", "Messages", "Mail"]),
  pauseAfter: oneOf(["off", "2", "5"], "2"),
  // Privacy & data
  offRecordStopsVideo: flag(true),
  keepUnconfirmedDays: oneOf(["7", "30", "90"], "30"),
  keepRecordings: oneOf(["90", "365", "forever"], "forever"),
  keepTranscripts: flag(true),
  expertReview: flag(false),
  // Work Maps
  openAs: oneOf(["map", "steps", "transcript"], "map"),
  highlightJudgment: flag(true),
  nameFromTask: flag(true),
  mergeRepeats: flag(false),
  exportFormat: oneOf(["pdf", "markdown", "sop"], "pdf"),
  exportThumbnails: flag(true),
  exportQuotes: flag(true),
  exportOpenQuestions: flag(false),
  // Teaching
  tutorVoice: oneOf(VOICES, "theo"),
  ruleBreak: oneOf(["now", "pause", "end"], "now"),
  askPredict: flag(true),
  masteredAfter: oneOf(["2", "3", "5"], "3"),
  sendReport: flag(true),
  // Pill & app
  pillPosition: oneOf(["bottom", "bottom-right", "top"], "bottom"),
  startInPill: flag(false),
  openAtLogin: flag(false),
  soundCues: flag(true),
  hideInShares: flag(true),
  appearance: oneOf(["system", "light", "dark"], "system"),
};

export type Settings = { [K in keyof typeof SPEC]: (typeof SPEC)[K]["fallback"] };
export type SettingKey = keyof Settings;

const KEYS = Object.keys(SPEC) as SettingKey[];

const copy = <T>(v: T): T => (Array.isArray(v) ? ([...v] as T) : v);

export function defaultSettings(): Settings {
  return Object.fromEntries(KEYS.map((k) => [k, copy(SPEC[k].fallback)])) as Settings;
}

/** Keeps the known keys whose values fit; everything else is dropped. */
function clean(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  return Object.fromEntries(
    KEYS.filter((k) => SPEC[k].valid(r[k])).map((k) => [k, copy(r[k])]),
  ) as Partial<Settings>;
}

/** The saved settings over the defaults. Bad or missing data falls back to the defaults. */
export function loadSettings(): Settings {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    // No localStorage, or not JSON.
  }
  return { ...defaultSettings(), ...clean(stored) };
}

/** Saves the valid entries of `partial` and returns the settings as now stored. */
export function saveSettings(partial: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...clean(partial) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // No localStorage or it's full: the choice holds until the page reloads.
  }
  return next;
}

export const saveSetting = <K extends SettingKey>(key: K, value: Settings[K]) =>
  saveSettings({ [key]: value } as Partial<Settings>);

export function resetSettings(): Settings {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing saved to remove.
  }
  return defaultSettings();
}

/** The settings, a setter that saves each change, and a reset. Loads after mount. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  useEffect(() => setSettings(loadSettings()), []);
  const set = useCallback(
    <K extends SettingKey>(key: K, value: Settings[K]) => setSettings(saveSetting(key, value)),
    [],
  );
  const reset = useCallback(() => setSettings(resetSettings()), []);
  return { settings, set, reset };
}

// Diagnostics

export type Diagnostic = {
  id: "backend" | "redaction" | "storage" | "apprentice-agent" | "tutor-agent";
  label: string;
  /** null: not checked. */
  ok: boolean | null;
  detail: string;
};

export const DIAGNOSTIC_TIMEOUT_MS = 5000;

type Answer = { status: number; body: unknown } | { error: string };

/** One GET with a timeout. Never throws; a body that isn't JSON comes back as null. */
async function get(fetchFn: typeof fetch, path: string, timeoutMs: number): Promise<Answer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Answer>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ error: `No answer after ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
  });
  const request = (async (): Promise<Answer> => {
    try {
      const r = await fetchFn(backendPath(path), {
        signal: controller.signal,
        cache: "no-store",
        headers: backendHeaders(),
      });
      const body: unknown = await r.json().catch(() => null);
      return { status: r.status, body };
    } catch {
      return { error: `Can't reach ${backendUrl().replace(/^https?:\/\//, "")}` };
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const field = (body: unknown, key: string): unknown =>
  body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;

/** Why a request failed, in a few words: the backend's own detail when it gives one. */
function failure(a: Answer): string {
  if ("error" in a) return a.error;
  if (a.status === 401) return ACCESS_KEY_MESSAGE;
  const detail = field(a.body, "detail");
  return typeof detail === "string" && detail ? detail : `The backend answered ${a.status}`;
}

const isOk = (a: Answer): a is { status: number; body: unknown } =>
  !("error" in a) && a.status >= 200 && a.status < 300;

async function agentCheck(
  fetchFn: typeof fetch,
  role: "apprentice" | "tutor",
  timeoutMs: number,
): Promise<Diagnostic> {
  const a = await get(fetchFn, `/api/v1/agent/token?role=${role}`, timeoutMs);
  // Only whether a token came back; the token itself is dropped here.
  const token = isOk(a) ? field(a.body, "token") : undefined;
  const gotToken = typeof token === "string" && token !== "";
  return {
    id: `${role}-agent`,
    label: role === "apprentice" ? "Apprentice voice agent" : "Tutor voice agent",
    ok: gotToken,
    detail: gotToken ? "Ready" : isOk(a) ? "No token in the answer" : failure(a),
  };
}

/**
 * Checks the backend, name redaction, Work Map storage and both voice agents.
 * The agent checks ask ElevenLabs for a token, so run this on request, not on page load.
 */
export async function runDiagnostics(
  fetchFn: typeof fetch = fetch,
  timeoutMs = DIAGNOSTIC_TIMEOUT_MS,
): Promise<Diagnostic[]> {
  const health = await get(fetchFn, "/health", timeoutMs);
  const up = isOk(health);
  const version = up ? field(health.body, "version") : undefined;
  const backend: Diagnostic = {
    id: "backend",
    label: "Backend",
    ok: up,
    detail: up
      ? [backendUrl().replace(/^https?:\/\//, ""), typeof version === "string" && `v${version}`]
          .filter(Boolean)
          .join(" · ")
      : failure(health),
  };
  const labels = {
    redaction: "Name redaction",
    storage: "Storage",
    "apprentice-agent": "Apprentice voice agent",
    "tutor-agent": "Tutor voice agent",
  } as const;
  if (!up) {
    return [
      backend,
      ...(Object.keys(labels) as (keyof typeof labels)[]).map((id) => ({
        id,
        label: labels[id],
        ok: null,
        detail: "Not checked: backend is down",
      })),
    ];
  }

  const engine = field(field(health.body, "privacy"), "engine");
  const redaction: Diagnostic = {
    id: "redaction",
    label: labels.redaction,
    ok: engine === "presidio" ? true : engine === "regex" ? false : null,
    detail:
      engine === "presidio"
        ? "Presidio"
        : engine === "regex"
          ? "Regex only: names aren't redacted"
          : "Not reported by this backend",
  };

  const [store, apprentice, tutor] = await Promise.all([
    get(fetchFn, "/api/v1/work_maps", timeoutMs),
    agentCheck(fetchFn, "apprentice", timeoutMs),
    agentCheck(fetchFn, "tutor", timeoutMs),
  ]);
  const storage: Diagnostic = {
    id: "storage",
    label: labels.storage,
    ok: isOk(store),
    detail: isOk(store)
      ? "Work Maps load"
      : "status" in store && store.status === 503
        ? "Storage unavailable"
        : failure(store),
  };

  return [backend, redaction, storage, apprentice, tutor];
}
