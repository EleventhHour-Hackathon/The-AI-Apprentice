/**
 * Autopilot for the practice ERP: an agent posts the routine invoices, people keep the
 * judgment calls. It reads the expert's exported Work Map (GET /work_maps/{id}/agent.json)
 * and asks `decide` about one invoice at a time.
 *
 * It fails closed: anything other than a clear "routine" goes to a person, with the
 * expert's rule and words, and is never posted.
 */
import type { Invoice } from "./sandbox";

/** One step of the export, as the backend's agent_export.to_json writes it. */
export type ExportStep = {
  id: string;
  title: string;
  decision: string;
  reason: string;
  judgment: boolean;
  expert_words: string;
  expert_words_english: string;
  quote_kind: string;
};

export type ExportGuardrail = {
  id: string;
  kind: "limit" | "exception" | "stop_and_ask";
  rule: string;
  applies_when: string;
  ask_whom: string;
  step: string;
  expert_words: string;
  expert_words_english: string;
  action: "stop_and_ask" | "enforce";
};

/** The Work Map for tool-using agents. Missing fields are "" or [], never null. */
export type AgentExport = {
  work_map_id: string;
  task: string;
  confirmed: boolean;
  steps: ExportStep[];
  guardrails: ExportGuardrail[];
  open_questions: string[];
  instructions: string;
};

export type Decision =
  { verdict: "routine" } | { verdict: "judgment"; guardrailId: string | null; why: string };
export type Decide = (invoice: Invoice, guardrails: ExportGuardrail[]) => Promise<Decision>;

export type PostAction = { invoiceId: string; costCenter: string };
export type ForYou = {
  invoiceId: string;
  guardrailId: string | null;
  rule: string;
  askWhom: string;
  expertWords: string;
  why: string;
};
export type Plan = { post: PostAction[]; forYou: ForYou[] };

export const COULD_NOT_DECIDE = "The agent couldn't decide, so a person should.";
export const NOT_CLEAR = "The agent's answer wasn't clear, so a person should.";
export const NO_GUARDRAILS =
  "This Work Map has no guardrails yet, so the agent can't tell routine from judgment.";

/** True if `value` is a well-formed Decision (the agent's answer comes from outside). */
export function isDecision(value: unknown): value is Decision {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.verdict === "routine") return true;
  return (
    v.verdict === "judgment" &&
    (v.guardrailId === null || typeof v.guardrailId === "string") &&
    typeof v.why === "string"
  );
}

const toPerson = (invoiceId: string, why: string): ForYou => ({
  invoiceId,
  guardrailId: null,
  rule: "",
  askWhom: "",
  expertWords: "",
  why,
});

/** What to post and what to hand to a person, for the open invoices in order. */
export async function plan(invoices: Invoice[], exp: AgentExport, decide: Decide): Promise<Plan> {
  const result: Plan = { post: [], forYou: [] };
  const open = invoices.filter((inv) => inv.status === "open");
  const guardrails = exp.guardrails ?? [];

  if (guardrails.length === 0) {
    result.forYou = open.map((inv) => toPerson(inv.id, NO_GUARDRAILS));
    return result;
  }

  // One at a time, so the agent's calls and the plan are in invoice order.
  for (const inv of open) {
    let answer: unknown;
    try {
      answer = await decide(inv, guardrails);
    } catch {
      result.forYou.push(toPerson(inv.id, COULD_NOT_DECIDE));
      continue;
    }
    if (!isDecision(answer)) {
      result.forYou.push(toPerson(inv.id, NOT_CLEAR));
      continue;
    }
    if (answer.verdict === "routine") {
      result.post.push({ invoiceId: inv.id, costCenter: inv.costCenter });
      continue;
    }
    const g = guardrails.find((x) => x.id === answer.guardrailId);
    result.forYou.push({
      invoiceId: inv.id,
      guardrailId: answer.guardrailId,
      rule: g?.rule ?? "",
      askWhom: g?.ask_whom ?? "",
      expertWords: g ? g.expert_words_english || g.expert_words : "",
      why: answer.why,
    });
  }
  return result;
}
