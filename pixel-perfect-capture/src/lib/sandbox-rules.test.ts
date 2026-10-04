import { describe, expect, it } from "vitest";
import { DATASETS, HISTORY, type Invoice, type PastInvoice } from "./sandbox";
import { CAPEX_LINE, judgmentCalls, type JudgmentRule } from "./sandbox-rules";

const expected: Record<string, JudgmentRule[]> = {
  "4471": ["capex_over_5000"],
  "4472": ["second_december_bill"],
  "4473": ["intercompany_approval"],
  "4474": [],
  "4480": ["capex_over_5000"],
  "4481": ["second_december_bill"],
  "4482": ["intercompany_approval"],
  "4483": [],
};

const base: Invoice = DATASETS.expert.invoices[3];
const invoice = (patch: Partial<Invoice>): Invoice => ({ ...base, id: "9000", ...patch });
const costing = (amount: number, costCenter: string) =>
  invoice({ lines: [{ description: "Machine", qty: 1, unit: amount }], costCenter });

describe("judgmentCalls", () => {
  it("finds exactly the expected rules in both datasets", () => {
    for (const set of [DATASETS.expert, DATASETS.newhire]) {
      for (const inv of set.invoices) {
        expect(
          judgmentCalls(inv).map((c) => c.rule),
          inv.id,
        ).toEqual(expected[inv.id]);
      }
    }
    expect(DATASETS.expert.invoices.length + DATASETS.newhire.invoices.length).toBe(8);
  });

  it("says why, with the amount", () => {
    const [capex] = judgmentCalls(DATASETS.expert.invoices[0]);
    expect(capex.why).toContain("€6,850.00");
    expect(capex.why).toContain("4711");
    expect(capex.why).toContain("0400");
    expect(judgmentCalls(DATASETS.newhire.invoices[0])[0].why).toContain("€7,200.00");
    const [twice] = judgmentCalls(DATASETS.expert.invoices[1]);
    expect(twice.why).toContain("€1,240.00");
    expect(twice.why).toContain("4466");
    expect(judgmentCalls(DATASETS.newhire.invoices[2])[0].why).toContain("€2,145.00");
  });

  it("draws the capex line at more than €5,000 on opex only", () => {
    expect(CAPEX_LINE).toBe(5000);
    expect(judgmentCalls(costing(5000, "4711"))).toEqual([]);
    expect(judgmentCalls(costing(5000.01, "4711")).map((c) => c.rule)).toEqual(["capex_over_5000"]);
    expect(judgmentCalls(costing(9000, "0400"))).toEqual([]);
  });

  it("counts an unknown cost center as neither opex nor intercompany", () => {
    expect(judgmentCalls(costing(9000, "9999"))).toEqual([]);
  });

  it("only flags a December bill after an earlier one that same month", () => {
    const supplier = "Test Freight GmbH";
    const dec = invoice({ supplier, date: "2026-12-12" });
    const past = (date: string): PastInvoice => ({ id: "1", supplier, date, amount: 1, note: "" });
    expect(judgmentCalls(dec, [past("2026-11-30")])).toEqual([]);
    expect(judgmentCalls(dec, [past("2025-12-03")])).toEqual([]);
    expect(judgmentCalls(dec, [past("2026-12-20")])).toEqual([]);
    expect(judgmentCalls(dec, [past("2026-12-01")]).map((c) => c.rule)).toEqual([
      "second_december_bill",
    ]);
    // Not December: a second bill in the same month is not this rule.
    const nov = invoice({ supplier, date: "2026-11-12" });
    expect(judgmentCalls(nov, [past("2026-11-01")])).toEqual([]);
  });

  it("uses the real history by default", () => {
    const schmidt = DATASETS.expert.invoices[1];
    expect(judgmentCalls(schmidt)).toEqual(judgmentCalls(schmidt, HISTORY));
    expect(judgmentCalls(schmidt, [])).toEqual([]);
  });
});
