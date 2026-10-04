import { BACKEND_URL } from "@/lib/backend";

// Saved by the backend (core/backend/src/services/work_map_merge.py). Maps from before the
// merge existed have fewer fields; normalizeMap fills them in so both open the same way.
type Source = "live" | "debrief" | "none";
/** "reason": the expert's reason in their words; "narration": what they said while doing it. */
export type QuoteKind = "reason" | "narration" | "none";
/** Where a guardrail's (or added step's) screen moment comes from; "model" is the merge's guess. */
export type AtSource = "said" | "step" | "nearby" | "model" | "none";
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
  quote_kind: QuoteKind;
  /** English translation of a quote said in another language; "" if it is English. */
  quote_translation: string;
  /** The language the quote was said in (ISO code), when known. */
  quote_language: string;
  at_source: AtSource;
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
  quote_kind: QuoteKind;
  /** English translation of a quote said in another language; "" if it is English. */
  quote_translation: string;
  /** The language the quote was said in (ISO code), when known. */
  quote_language: string;
  at: number | null;
  at_source: AtSource;
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
  /** Questions the apprentice asked at pauses while the expert worked (from the backend). */
  live_questions?: LiveQuestionRecord[];
  /** The teach-back the expert confirmed, and what they said to confirm it (session clock). */
  confirmation?: Confirmation | undefined;
};
export type Confirmation = { teach_back: string; said: string; t: number | null };
export type LiveQuestionRecord = {
  t: number | null;
  text: string;
  kind: "guardrail" | "reason" | "other";
  /** Put off for the debrief with Later. */
  deferred: boolean;
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
// Maps merged before quote_kind existed only kept reasons.
const quoteKind = (v: unknown, quote: string): QuoteKind =>
  v === "reason" || v === "narration" ? v : quote ? "reason" : "none";
const atSource = (v: unknown): AtSource =>
  v === "said" || v === "step" || v === "nearby" || v === "model" ? v : "none";

/** What an item is missing to be fully linked: its screen moment and/or the expert's words. */
export const unlinked = (item: { at: number | null; quote: string }) =>
  [item.at === null && "screen moment", !item.quote && "expert's words"].filter((x): x is string =>
    Boolean(x),
  );

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
    quote_kind: quoteKind(s["quote_kind"], text(s["quote"])),
    quote_translation: text(s["quote_translation"]),
    quote_language: text(s["quote_language"]),
    at_source: atSource(s["at_source"]),
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
      quote_kind: quoteKind(g["quote_kind"], text(g["quote"])),
      quote_translation: text(g["quote_translation"]),
      quote_language: text(g["quote_language"]),
      at: num(g["at"]),
      at_source: atSource(g["at_source"]),
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
  const c = record.confirmation as Record<string, unknown> | null | undefined;
  const confirmation =
    c && typeof c === "object" && text(c["said"])
      ? { teach_back: text(c["teach_back"]), said: text(c["said"]), t: num(c["t"]) }
      : undefined;
  return { ...record, steps, guardrails, transcript, confirmation };
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

async function send(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("Couldn’t reach the apprentice backend.");
  }
  if (response.status === 404) throw new Error("This Work Map doesn’t exist.");
  if (response.status === 503) throw new Error("Work Map storage (Supabase) is unavailable.");
  if (!response.ok) throw new Error(`The backend answered ${response.status}.`);
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await send(`${BACKEND_URL}/api/v1${path}`, init)).json()) as T;
}

export const fetchWorkMaps = () => request<WorkMapSummary[]>("/work_maps");
export const fetchWorkMap = (id: string) =>
  request<WorkMapRecord>(`/work_maps/${encodeURIComponent(id)}`);
export const deleteWorkMap = (id: string) =>
  request<{ deleted: string }>(`/work_maps/${encodeURIComponent(id)}`, { method: "DELETE" });
/** The Work Map as instructions another agent can load: a Markdown system prompt, or JSON. */
export const agentExportUrl = (id: string, format: "md" | "json") =>
  `${BACKEND_URL}/api/v1/work_maps/${encodeURIComponent(id)}/agent.${format}`;
/** The agent instructions as a Markdown file, ready to download. */
export const fetchAgentInstructions = async (id: string) =>
  (await send(agentExportUrl(id, "md"))).blob();

/** How two Work Maps of one task differ (core/backend/src/services/work_map_diff.py). */
export type DiffWords = { quote: string; quote_translation: string; reason: string };
export type DiffField = {
  field: string;
  kind: "changed" | "missing_a" | "missing_b";
  a: unknown;
  b: unknown;
};
export type DiffSection = {
  same: { a: string; b: string; title: string; score: number }[];
  differs: {
    a: string;
    b: string;
    title_a: string;
    title_b: string;
    score: number;
    fields: DiffField[];
    words_a: DiffWords;
    words_b: DiffWords;
  }[];
  only_a: { id: string; title: string; words: DiffWords }[];
  only_b: { id: string; title: string; words: DiffWords }[];
};
export type WorkMapDiff = { steps: DiffSection; guardrails: DiffSection };
/** A question for one expert about one difference; both sides of a difference share its id. */
export type DiffQuestion = {
  id: string;
  section: "steps" | "guardrails";
  /** The asked expert's own item id. */
  item: string;
  /** The matching item in the other map; null when only this expert did it. */
  other: string | null;
  /** The diff field asked about, or "only". */
  field: string;
  text: string;
  /** The asked expert's words the question quotes, "" if none. */
  quote: string;
};
export type DiffSide = {
  id: string;
  task: string | null;
  recorded_at: string | null;
  confirmed: boolean;
  status: string;
  steps: number;
  guardrails: number;
};
export type WorkMapDiffResponse = {
  a: DiffSide;
  b: DiffSide;
  diff: WorkMapDiff;
  questions: { a: DiffQuestion[]; b: DiffQuestion[] };
};

/** Why the diff couldn't be loaded, from the response status and its `detail`. */
export function diffError(status: number, detail: unknown): string {
  if (status === 404) {
    if (detail === "Work Map a not found") return "Session A no longer exists. Pick another one.";
    if (detail === "Work Map b not found") return "Session B no longer exists. Pick another one.";
    return "That isn’t a Work Map id.";
  }
  if (status === 422)
    return Array.isArray(detail)
      ? "The compare link is incomplete."
      : "Pick two different sessions.";
  if (status === 503) return "Work Map storage (Supabase) is unavailable.";
  return `The backend answered ${status}.`;
}

/** The difference between two Work Maps, with the questions to ask each expert (at most `limit` each). */
export async function fetchWorkMapDiff(
  a: string,
  b: string,
  limit?: number,
  init?: RequestInit,
): Promise<WorkMapDiffResponse> {
  const params = new URLSearchParams({ a, b });
  if (limit !== undefined) params.set("limit", String(limit));
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/api/v1/work_map_diff?${params}`, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("Couldn’t reach the apprentice backend.");
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(diffError(response.status, body?.["detail"]));
  const result = body as unknown as WorkMapDiffResponse;
  return { ...result, questions: result.questions ?? { a: [], b: [] } };
}

// Questions kept for an expert's next session (core/backend/src/router/follow_ups_router.py).
/** A question waiting for the expert's next session; `from` is the Work Map it came from. */
export type FollowUp = {
  question_id: string;
  text: string;
  quote: string;
  from: string;
  added_at: string;
};
/** The endpoint refuses a longer text or quote. */
export const FOLLOW_UP_MAX_CHARS = 300;
/** The most questions one request may keep. */
export const FOLLOW_UP_MAX_BATCH = 10;

/** Why a follow-up question couldn't be listed, kept or withdrawn. */
export function followUpError(status: number, detail: unknown): string {
  if (status === 404)
    return detail === "No such question waiting"
      ? "That question is no longer waiting."
      : "That session no longer exists.";
  if (status === 422)
    return typeof detail === "string"
      ? detail
      : "The question couldn’t be kept: it is too long or incomplete.";
  if (status === 503) return "Work Map storage (Supabase) is unavailable.";
  return `The backend answered ${status}.`;
}

async function followUpRequest<T>(id: string, query: string, init?: RequestInit): Promise<T> {
  const url = `${BACKEND_URL}/api/v1/work_maps/${encodeURIComponent(id)}/follow_up_questions${query}`;
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("Couldn’t reach the apprentice backend.");
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(followUpError(response.status, body?.["detail"]));
  return (body ?? {}) as T;
}

/** The questions waiting for this Work Map's expert, oldest first. */
export async function fetchFollowUps(id: string, init?: RequestInit): Promise<FollowUp[]> {
  const body = await followUpRequest<{ questions?: FollowUp[] }>(id, "", init);
  return body.questions ?? [];
}

const cut = (s: string | null | undefined) => (s ?? "").trim().slice(0, FOLLOW_UP_MAX_CHARS);

/** Keep questions (at most 10) for this Work Map's expert; `fromId` is the map it was compared with. */
export async function postFollowUps(
  id: string,
  questions: DiffQuestion[],
  fromId: string,
): Promise<{ added: string[]; questions: FollowUp[] }> {
  const items = questions
    .filter((q) => cut(q.text))
    .slice(0, FOLLOW_UP_MAX_BATCH)
    .map((q) => ({ id: q.id, text: cut(q.text), quote: cut(q.quote), from_work_map_id: fromId }));
  if (items.length === 0) throw new Error("Nothing to ask.");
  const body = await followUpRequest<{ added?: string[]; questions?: FollowUp[] }>(id, "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions: items }),
  });
  return { added: body.added ?? [], questions: body.questions ?? [] };
}

/** Withdraw a waiting question. Its id contains ":", so it goes in the query, never the path. */
export async function withdrawFollowUp(
  id: string,
  questionId: string,
): Promise<{ withdrawn: string; questions: FollowUp[] }> {
  const params = new URLSearchParams({ question_id: questionId });
  const body = await followUpRequest<{ withdrawn?: string; questions?: FollowUp[] }>(
    id,
    `?${params}`,
    { method: "DELETE" },
  );
  return { withdrawn: body.withdrawn ?? questionId, questions: body.questions ?? [] };
}

/** A file name from the task: lowercase ASCII words joined by "-", or "work-map". */
export const fileSlug = (task: string | null) =>
  (task ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "work-map";

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
