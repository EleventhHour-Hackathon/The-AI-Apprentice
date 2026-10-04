/**
 * Sia on the Work Map: the guide agent (core/backend/src/services/apprentice_agent.py, role
 * "guide") walks a new hire (learn) or the expert (review) through a saved Work Map. This is what
 * the page tells it: the map as text, the step in focus, and what next_step answers.
 */
import { AccessKeyError } from "./backend";
import type { WorkMapRecord } from "./work-maps";

export type GuideMode = "learn" | "review";
/** The step or guardrail selected on the map (WorkMap's MapFocus). */
export type GuideFocus = { kind: "step" | "guardrail"; id: string } | null;

type Item = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const GUARD_KIND: Record<string, string> = {
  limit: "Limit",
  exception: "Exception",
  stop_and_ask: "Stop and ask",
};

// Ids as the backend and WorkMap give them: the saved id, else the position.
const stepId = (s: Item, i: number) => text(s["id"]) || `s${i + 1}`;
const guardId = (g: Item, i: number) => text(g["id"]) || `g${i + 1}`;
const stepTitle = (s: Item) => text(s["title"]) || text(s["step"]);
const inEnglish = (item: Item) =>
  text(item["quote_translation"]) ? ` (in English: "${text(item["quote_translation"])}")` : "";

function stepBlock(s: Item, i: number) {
  let line = `${stepId(s, i)}. ${stepTitle(s)}`;
  if (s["judgment"]) line += " [judgment call]";
  if (text(s["decision"]))
    line += `\n   Decision the expert made on their case: ${text(s["decision"])}`;
  const quote = text(s["quote"]);
  const narration = s["quote_kind"] === "narration";
  if (quote && !narration) line += `\n   Expert's words: "${quote}"${inEnglish(s)}`;
  else if (text(s["reason"])) {
    const label = s["reason_source"] === "inferred" ? "Assumed reason" : "Reason";
    line += `\n   ${label}: ${text(s["reason"])}`;
  }
  if (quote && narration)
    line += `\n   Said while doing it (not a reason): "${quote}"${inEnglish(s)}`;
  return line;
}

function guardBlock(g: Item, i: number) {
  let line = `${guardId(g, i)}. ${GUARD_KIND[text(g["kind"])] ?? "Rule"}: ${text(g["rule"])}`;
  if (text(g["step"])) line += ` (step ${text(g["step"])})`;
  if (text(g["applies_when"])) line += `\n   Applies when: ${text(g["applies_when"])}`;
  if (text(g["ask_whom"])) line += `\n   Ask: ${text(g["ask_whom"])}`;
  if (text(g["quote"])) line += `\n   Expert's words: "${text(g["quote"])}"${inEnglish(g)}`;
  return line;
}

/** The Work Map as the guide reads it: the same text as tutor.work_map_text on the backend. */
export function workMapText(map: Pick<WorkMapRecord, "steps" | "guardrails">) {
  const lines = ["STEPS (in order)", ...map.steps.map(stepBlock), "\nGUARDRAILS"];
  lines.push(...map.guardrails.map(guardBlock));
  if (lines.length === 2) lines.push("(none)");
  return lines.join("\n");
}

/** The focused_step variable: "s3. <title>", "g2. <rule>", or "none". */
export function focusedStep(map: Pick<WorkMapRecord, "steps" | "guardrails">, focus: GuideFocus) {
  if (!focus) return "none";
  if (focus.kind === "step") {
    const i = map.steps.findIndex((s, n) => stepId(s, n) === focus.id);
    return i < 0 ? "none" : `${focus.id}. ${stepTitle(map.steps[i]!)}`;
  }
  const i = map.guardrails.findIndex((g, n) => guardId(g, n) === focus.id);
  return i < 0 ? "none" : `${focus.id}. ${text(map.guardrails[i]!["rule"])}`;
}

/** Whether a step with this id is on the map. */
export const hasStep = (map: Pick<WorkMapRecord, "steps">, id: string) =>
  map.steps.some((s, i) => stepId(s, i) === id);

/**
 * The step after the one in focus: the first step when nothing is, and for a guardrail the step
 * after the one it belongs to (the first step if it belongs to none). null after the last step.
 */
export function nextStepId(
  map: Pick<WorkMapRecord, "steps" | "guardrails">,
  focus: GuideFocus,
): string | null {
  const ids = map.steps.map(stepId);
  let from = "";
  if (focus?.kind === "step") from = focus.id;
  else if (focus?.kind === "guardrail") {
    const g = map.guardrails.find((x, i) => guardId(x, i) === focus.id);
    from = g ? text(g["step"]) : "";
  }
  const at = from ? ids.indexOf(from) : -1;
  return ids[at + 1] ?? null;
}

/** What next_step answers: the step as the Work Map has it, with its guardrails. */
export function stepForGuide(map: Pick<WorkMapRecord, "steps" | "guardrails">, id: string | null) {
  const i = id === null ? -1 : map.steps.findIndex((s, n) => stepId(s, n) === id);
  if (i < 0) return "There are no more steps. The walk-through is done.";
  const guards = map.guardrails
    .map((g, n) => ({ g, n }))
    .filter(({ g }) => text(g["step"]) === id)
    .map(({ g, n }) => guardBlock(g, n));
  const position = `Step ${i + 1} of ${map.steps.length}, now shown on the map:`;
  return [position, stepBlock(map.steps[i]!, i), ...guards].join("\n");
}

/** The cue for a node the person selected on the map. */
export const focusCue = (id: string) => `[FOCUS step=${id}]`;

/**
 * The person's words as said, if they really said them lately (else ""): edit_work_map keeps
 * them as the quote for the change, the way the apprentice does.
 */
export function spokenRecently(said: string, heard: string[]) {
  const words = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const recent = words(heard.slice(-3).join(" "));
  const wanted = words(said);
  return wanted && recent.includes(wanted) ? said.trim() : "";
}

/** Why Sia couldn't start, in words: the microphone, the access key, or the backend. */
export function guideError(error: unknown) {
  if (error instanceof AccessKeyError) return error.message;
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (name === "NotAllowedError" || name === "SecurityError" || /permission/i.test(message))
    return "Sia needs your microphone. Allow microphone access for Tacit and try again.";
  if (name === "NotFoundError") return "No microphone found. Connect one and try again.";
  if (name === "TypeError" || /failed to fetch|network/i.test(message))
    return "Couldn't reach the Tacit backend. Check your connection and try again.";
  return `Couldn't start Sia.${message ? ` ${message}` : ""}`;
}
