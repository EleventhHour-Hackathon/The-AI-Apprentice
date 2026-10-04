/**
 * The autopilot's link to the backend (POST /work_maps/{id}/decide) and what its plan does to
 * the practice ERP's invoices.
 *
 * The ERP never applies the expert's rules itself: the backend's agent decides each invoice
 * against the Work Map, and anything other than a clear "routine" goes to a person.
 */
import {
  ACCESS_KEY_MESSAGE,
  AccessKeyError,
  backendFetch,
  backendHeaders,
  backendPath,
  reportUnauthorized,
} from "./backend";
import { plan, isDecision, type AgentExport, type Decide, type Plan } from "./autopilot";
import { agentExportUrl } from "./work-maps";
import { COST_CENTERS, HISTORY, type Invoice, type PastInvoice } from "./sandbox";

/** One line of the ERP's activity log. */
export type Log = { at: string; text: string };

export type DecideBody = {
  invoice: Omit<Invoice, "contact" | "status" | "note"> & { costCenterName: string };
  history: Omit<PastInvoice, "supplier">[];
};

/** What the backend's agent may see: no supplier contact, plus the earlier invoices it shows. */
export function toDecideBody(invoice: Invoice, history: PastInvoice[] = HISTORY): DecideBody {
  // Destructured out so they never reach the agent.
  const { contact, status, note, ...rest } = invoice;
  return {
    invoice: {
      ...rest,
      costCenterName: COST_CENTERS.find((c) => c.code === invoice.costCenter)?.name ?? "",
    },
    history: history
      .filter((h) => h.supplier === invoice.supplier && h.id !== invoice.id)
      .map(({ id, date, amount, note }) => ({ id, date, amount, note })),
  };
}

/** The agent can't be used at all (no key, OpenAI unreachable): the backend's 503 detail. */
export class AutopilotUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutopilotUnavailable";
  }
}

const UNAVAILABLE = "The autopilot is unavailable. Nothing was posted.";

/** A Decide that asks the backend's agent about one invoice against this Work Map. */
export function decideRemote(
  workMapId: string,
  { timeoutMs = 20_000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Decide {
  // The guardrails argument is ignored: the backend reads the same Work Map.
  return async (invoice) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(
        backendPath(`/api/v1/work_maps/${encodeURIComponent(workMapId)}/decide`),
        {
          method: "POST",
          headers: backendHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(toDecideBody(invoice)),
          signal: controller.signal,
        },
      );
      if (response.status === 401) {
        reportUnauthorized();
        throw new AutopilotUnavailable(`${ACCESS_KEY_MESSAGE}. Nothing was posted.`);
      }
      if (response.status === 503) {
        const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
        throw new AutopilotUnavailable(
          typeof body?.detail === "string" && body.detail ? body.detail : UNAVAILABLE,
        );
      }
      if (!response.ok) throw new Error(`The backend answered ${response.status}.`);
      const body: unknown = await response.json();
      if (!isDecision(body)) throw new Error("The backend's answer isn't a decision.");
      return body;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The Work Map as the agent sees it. */
export async function fetchAgentExport(id: string): Promise<AgentExport> {
  let response: Response;
  try {
    response = await backendFetch(agentExportUrl(id, "json"));
  } catch (e) {
    if (e instanceof AccessKeyError) throw e;
    throw new Error("Couldn’t reach the apprentice backend.");
  }
  if (response.status === 404) throw new Error("This Work Map doesn’t exist.");
  if (!response.ok) throw new Error(`The backend answered ${response.status}.`);
  return (await response.json()) as AgentExport;
}

/**
 * Plan the open invoices with `decide`. Once the agent is unavailable it isn't asked again:
 * the remaining invoices go to a person, and `unavailable` says why.
 */
export async function runAutopilot(
  invoices: Invoice[],
  exp: AgentExport,
  decide: Decide,
): Promise<{ plan: Plan; unavailable: string | null }> {
  let unavailable: string | null = null;
  const guarded: Decide = async (invoice, guardrails) => {
    if (unavailable !== null) throw new AutopilotUnavailable(unavailable);
    try {
      return await decide(invoice, guardrails);
    } catch (e) {
      if (e instanceof AutopilotUnavailable) unavailable = e.message;
      throw e;
    }
  };
  return { plan: await plan(invoices, exp, guarded), unavailable };
}

/**
 * Post what the plan says to post, if the invoice is still open with the same cost center
 * (a person may have changed it while the agent was deciding). New log lines come newest first.
 */
export function applyPlan(
  invoices: Invoice[],
  p: Plan,
  at: string,
): { invoices: Invoice[]; log: Log[] } {
  const log: Log[] = [];
  const next = invoices.map((inv) => {
    const action = p.post.find((a) => a.invoiceId === inv.id);
    if (!action || inv.status !== "open" || inv.costCenter !== action.costCenter) return inv;
    const cc = COST_CENTERS.find((c) => c.code === inv.costCenter);
    log.unshift({
      at,
      text: `Invoice ${inv.id} posted by the autopilot to ${inv.costCenter} ${cc?.name ?? ""}`.trim(),
    });
    return { ...inv, status: "posted" as const, note: "" };
  });
  return { invoices: next, log };
}
