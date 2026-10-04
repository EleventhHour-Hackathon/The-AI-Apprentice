/**
 * The practice ERP's hidden rules, written down: which invoices are judgment calls.
 *
 * This is the oracle for tests and the sandbox, not something the agent sees. The agent
 * only gets the expert's Work Map; this module says what the right answer would have been,
 * so we can check that it never posts a judgment call.
 */
import {
  COST_CENTERS,
  HISTORY,
  eur,
  total,
  type CostCenter,
  type Invoice,
  type PastInvoice,
} from "./sandbox";

export type JudgmentRule = "capex_over_5000" | "second_december_bill" | "intercompany_approval";
export type JudgmentCall = { rule: JudgmentRule; why: string };

/** Above this total, equipment is a fixed asset (capex), not an expense. */
export const CAPEX_LINE = 5000;

// "YYYY-MM-DD" compared as strings, so the local time zone never shifts a date.
const yearMonth = (date: string) => date.slice(0, 7);
const isDecember = (date: string) => date.slice(5, 7) === "12";

/** The judgment calls in an invoice, in rule order; [] means it is routine. */
export function judgmentCalls(
  invoice: Invoice,
  history: PastInvoice[] = HISTORY,
  costCenters: CostCenter[] = COST_CENTERS,
): JudgmentCall[] {
  const calls: JudgmentCall[] = [];
  // An unknown cost center has no kind, so it is neither opex nor intercompany.
  const kind = costCenters.find((c) => c.code === invoice.costCenter)?.kind;
  const amount = total(invoice);
  const capex = costCenters.find((c) => c.kind === "capex")?.code ?? "0400";

  if (amount > CAPEX_LINE && kind === "opex") {
    calls.push({
      rule: "capex_over_5000",
      why: `${eur(amount)} of equipment coded to opex cost center ${invoice.costCenter}; over ${eur(CAPEX_LINE)} it is capex (${capex})`,
    });
  }

  if (isDecember(invoice.date)) {
    const earlier = history.find(
      (h) =>
        h.supplier === invoice.supplier &&
        h.id !== invoice.id &&
        yearMonth(h.date) === yearMonth(invoice.date) &&
        h.date < invoice.date,
    );
    if (earlier) {
      calls.push({
        rule: "second_december_bill",
        why: `${eur(amount)} from ${invoice.supplier} on ${invoice.date}, after invoice ${earlier.id} (${eur(earlier.amount)}) on ${earlier.date}; this supplier has billed December twice before`,
      });
    }
  }

  if (kind === "intercompany") {
    calls.push({
      rule: "intercompany_approval",
      why: `${eur(amount)} from ${invoice.supplier} on intercompany cost center ${invoice.costCenter}; it needs a second approval`,
    });
  }

  return calls;
}
