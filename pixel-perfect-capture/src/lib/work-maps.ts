import { BACKEND_URL } from "@/lib/backend";

// Saved by the backend (core/backend/src/services/work_map_merge.py). Maps from before the
// merge existed have fewer fields; normalizeMap fills them in so both open the same way.
type Source = "live" | "debrief" | "none";
export type WorkMapStep = {
  id: string;
  title: string;
  /** Seconds into the session of the screen moment. */
  at: number | null;
  screen: string;
  decision: string;
  reason: string;
  /** The expert's exact words, checked against the transcript. */
  quote: string;
  quote_at: number | null;
  quote_source: Source;
  judgment: boolean;
  thumb: string | null;
  /** A few seconds of the expert doing this step (mp4), if the screen was recorded. */
  clip: string | null;
  event: string | null;
};
export type GuardKind = "limit" | "exception" | "stop_and_ask";
export type WorkMapGuardrail = {
  id: string;
  /** Id of the step it belongs to, or "". */
  step: string;
  kind: GuardKind;
  rule: string;
  applies_when: string;
  ask_whom: string;
  quote: string;
  quote_at: number | null;
  quote_source: Source;
  at: number | null;
  thumb: string | null;
  clip: string | null;
  event: string | null;
};
export type TranscriptLine = { who: "expert" | "apprentice"; text: string; t: number | null };
export type WorkMapRecord = {
  id: string;
  task: string | null;
  recorded_at: string | null;
  confirmed?: boolean;
  status?: string;
  duration?: number | null;
  steps: Record<string, unknown>[];
  guardrails: Record<string, unknown>[];
  open_questions: string[];
  corrections?: string[];
  transcript?: Record<string, unknown>[];
};
export type WorkMap = Omit<WorkMapRecord, "steps" | "guardrails" | "transcript"> & {
  steps: WorkMapStep[];
  guardrails: WorkMapGuardrail[];
  transcript: TranscriptLine[];
};

const text = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clipUrl = (v: unknown) => (text(v) ? `${BACKEND_URL}${text(v)}` : null);
const source = (v: unknown): Source => (v === "live" || v === "debrief" ? v : "none");

export function normalizeMap(record: WorkMapRecord): WorkMap {
  const steps = record.steps.map((s, i): WorkMapStep => ({
    id: text(s["id"]) || `s${i + 1}`,
    title: text(s["title"]) || text(s["step"]),
    at: num(s["at"]),
    screen: text(s["screen"]) || text(s["screen_moment"]),
    decision: text(s["decision"]),
    reason: text(s["reason"]),
    quote: text(s["quote"]),
    quote_at: num(s["quote_at"]),
    quote_source: source(s["quote_source"]),
    judgment: typeof s["judgment"] === "boolean" ? s["judgment"] : Boolean(text(s["decision"])),
    thumb: text(s["thumb"]) || null,
    clip: clipUrl(s["clip"]),
    event: text(s["event"]) || null,
  }));
  const guardrails = record.guardrails.map((g, i): WorkMapGuardrail => {
    const legacyAsk = text(g["stop_and_ask"]);
    const kind = g["kind"];
    return {
      id: text(g["id"]) || `g${i + 1}`,
      step: text(g["step"]),
      kind:
        kind === "limit" || kind === "exception" || kind === "stop_and_ask"
          ? kind
          : legacyAsk
            ? "stop_and_ask"
            : "limit",
      rule: text(g["rule"]),
      applies_when: text(g["applies_when"]),
      ask_whom: text(g["ask_whom"]) || legacyAsk,
      quote: text(g["quote"]),
      quote_at: num(g["quote_at"]),
      quote_source: source(g["quote_source"]),
      at: num(g["at"]),
      thumb: text(g["thumb"]) || null,
      clip: clipUrl(g["clip"]),
      event: text(g["event"]) || null,
    };
  });
  const transcript = (record.transcript ?? []).flatMap((l): TranscriptLine[] => {
    const role = l["role"];
    const words = text(l["text"]) || text(l["content"]);
    if (!words.trim()) return [];
    const who = role === "expert" || role === "user" ? "expert" : "apprentice";
    return [{ who, text: words, t: num(l["t"]) }];
  });
  return { ...record, steps, guardrails, transcript };
}

export const guardLabel: Record<GuardKind, string> = {
  limit: "Limit",
  exception: "Exception",
  stop_and_ask: "Stop and ask",
};

export const mmss = (seconds: number | null) =>
  seconds === null
    ? ""
    : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export type WorkMapSummary = {
  id: string;
  task: string | null;
  recorded_at: string | null;
  confirmed: boolean;
  steps: number;
  guardrails: number;
  open_questions: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/api/v1${path}`, init);
  } catch {
    throw new Error("Couldn’t reach the apprentice backend.");
  }
  if (response.status === 404) throw new Error("This Work Map doesn’t exist.");
  if (response.status === 503) throw new Error("Work Map storage (Supabase) is unavailable.");
  if (!response.ok) throw new Error(`The backend answered ${response.status}.`);
  return (await response.json()) as T;
}

export const fetchWorkMaps = () => request<WorkMapSummary[]>("/work_maps");
export const fetchWorkMap = (id: string) =>
  request<WorkMapRecord>(`/work_maps/${encodeURIComponent(id)}`);
export const deleteWorkMap = (id: string) =>
  request<{ deleted: string }>(`/work_maps/${encodeURIComponent(id)}`, { method: "DELETE" });

export const taskTitle = (task: string | null) => {
  const t = task?.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Untitled session";
};

export const recordedAt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unknown time";

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Unconfirmed Work Maps are kept this long after they are recorded. */
export const UNCONFIRMED_RETENTION_DAYS = 30;

/** Whole days until an unconfirmed Work Map is deleted (0 = due now), or null if its time is unknown. */
export const daysUntilDeleted = (iso: string | null, now = Date.now()) => {
  const recorded = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(recorded)) return null;
  const left = recorded + UNCONFIRMED_RETENTION_DAYS * 86_400_000 - now;
  return Math.max(0, Math.ceil(left / 86_400_000));
};
