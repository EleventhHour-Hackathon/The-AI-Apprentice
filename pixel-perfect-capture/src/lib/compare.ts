// Comparing two Work Maps of one task: which session to pick, and the diff from the backend
// (GET /api/v1/work_map_diff) turned into rows the compare page can show.
import {
  guardLabel,
  type DiffField,
  type DiffQuestion,
  type DiffSection,
  type DiffWords,
  type GuardKind,
  type WorkMapDiff,
  type WorkMapSummary,
} from "@/lib/work-maps";

const normalTask = (task: string | null | undefined) =>
  (task ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Whether two sessions are of the same task. Sessions without a task never match. */
export const sameTask = (a: string | null | undefined, b: string | null | undefined) => {
  const x = normalTask(a);
  return x !== "" && x === normalTask(b);
};

const time = (iso: string | null) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

/** The sessions to compare session A with: those of A's task first, then the rest, newest first. */
export function pickerGroups(maps: WorkMapSummary[], aId: string | undefined) {
  const a = maps.find((m) => m.id === aId);
  const others = maps
    .filter((m) => m.id !== aId)
    .sort((x, y) => time(y.recorded_at) - time(x.recorded_at));
  const same = others.filter((m) => sameTask(a?.task, m.task));
  return { sameTask: same, otherTasks: others.filter((m) => !same.includes(m)) };
}

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

/** The expert's words for an item: the English translation, else the quote, else the reason. */
export const words = (w: Partial<DiffWords> | null | undefined) =>
  w?.quote_translation || w?.quote || w?.reason || "";

export const FIELD_LABELS: Record<string, string> = {
  decision: "Decision",
  reason: "Reason",
  judgment: "Judgment",
  guardrails: "Rules on this step",
  rule: "Rule",
  kind: "Kind",
  ask_whom: "Who to ask",
  applies_when: "Applies when",
  numbers: "Numbers",
  step: "Step",
};

const fieldLabel = (field: string) =>
  FIELD_LABELS[field] ?? field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");

// Plain numbers get thousands separators; codes with a leading zero ("0400") stay as they are.
const number = (v: string) =>
  /^[1-9]\d*(\.\d+)?$/.test(v) || /^0\.\d+$/.test(v)
    ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 20 })
    : v;

/** One side's value of a differing field, as words. */
export function fieldValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "Not said";
  if (Array.isArray(v)) {
    const items = v.map((x) => (field === "numbers" ? number(String(x)) : String(x)));
    return items.length ? items.join(", ") : "Not said";
  }
  if (field === "judgment" && typeof v === "boolean") return v ? "Judgment call" : "Routine";
  if (field === "kind" && typeof v === "string" && v in guardLabel)
    return guardLabel[v as GuardKind];
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (field === "numbers" && typeof v === "string") return number(v);
  return String(v);
}

export type RowKind = "same" | "differs" | "only_a" | "only_b";
export type CompareField = { field: string; label: string; a: string; b: string; kind: string };
export type CompareRow = {
  kind: RowKind;
  key: string;
  /** "" when the item is only in session B. */
  titleA: string;
  /** "" when the item is only in session A. */
  titleB: string;
  /** Only for "differs". */
  fields: CompareField[];
  wordsA: string;
  wordsB: string;
};

const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

function sectionRows(section: Partial<DiffSection> | null | undefined): CompareRow[] {
  const s = section ?? {};
  return [
    ...list(s.differs).map((d): CompareRow => ({
      kind: "differs",
      key: `differs:${d.a}:${d.b}`,
      titleA: d.title_a ?? "",
      titleB: d.title_b ?? "",
      fields: list<DiffField>(d.fields).map((f) => ({
        field: f.field,
        label: fieldLabel(f.field),
        a: fieldValue(f.field, f.a),
        b: fieldValue(f.field, f.b),
        kind: f.kind,
      })),
      wordsA: words(d.words_a),
      wordsB: words(d.words_b),
    })),
    ...list(s.only_a).map((o): CompareRow => ({
      kind: "only_a",
      key: `only_a:${o.id}`,
      titleA: o.title ?? "",
      titleB: "",
      fields: [],
      wordsA: words(o.words),
      wordsB: "",
    })),
    ...list(s.only_b).map((o): CompareRow => ({
      kind: "only_b",
      key: `only_b:${o.id}`,
      titleA: "",
      titleB: o.title ?? "",
      fields: [],
      wordsA: "",
      wordsB: words(o.words),
    })),
    ...list(s.same).map((m): CompareRow => ({
      kind: "same",
      key: `same:${m.a}:${m.b}`,
      titleA: m.title ?? "",
      titleB: m.title ?? "",
      fields: [],
      wordsA: "",
      wordsB: "",
    })),
  ];
}

/** The diff as rows per section: differences first, then items only one session has, then the same ones. */
export const compareRows = (diff: Partial<WorkMapDiff> | null | undefined) => ({
  steps: sectionRows(diff?.steps),
  guardrails: sectionRows(diff?.guardrails),
});

/** The questions for one side's expert; none when the backend sent no questions. */
export const questionsFor = (
  response: { questions?: Partial<Record<"a" | "b", DiffQuestion[]>> | null } | null | undefined,
  side: "a" | "b",
): DiffQuestion[] => list(response?.questions?.[side]);
