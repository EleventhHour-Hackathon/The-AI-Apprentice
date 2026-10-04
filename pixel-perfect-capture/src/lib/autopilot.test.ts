import { describe, expect, it, vi } from "vitest";
import {
  COULD_NOT_DECIDE,
  NO_GUARDRAILS,
  NOT_CLEAR,
  isDecision,
  plan,
  type AgentExport,
  type Decide,
  type ExportGuardrail,
} from "./autopilot";
import { DATASETS, type Invoice } from "./sandbox";
import { judgmentCalls, type JudgmentRule } from "./sandbox-rules";

const guard = (g: Partial<ExportGuardrail> & Pick<ExportGuardrail, "id">): ExportGuardrail => ({
  kind: "stop_and_ask",
  rule: "",
  applies_when: "",
  ask_whom: "",
  step: "",
  expert_words: "",
  expert_words_english: "",
  action: "stop_and_ask",
  ...g,
});

const exp: AgentExport = {
  work_map_id: "wm-1",
  task: "Post supplier invoices",
  confirmed: true,
  steps: [],
  guardrails: [
    guard({
      id: "g1",
      kind: "limit",
      action: "enforce",
      rule: "Equipment over €5,000 is capex: code it to 0400, not opex",
      applies_when: "invoice total over 5,000 on an opex cost center",
      ask_whom: "Controller (M. Weber)",
      expert_words: "Über fünftausend ist das Anlagevermögen.",
      expert_words_english: "Over five thousand, that's a fixed asset.",
    }),
    guard({
      id: "g2",
      rule: "Schmidt bills December freight twice: check HISTORY before posting",
      ask_whom: "Head of Finance (K. Brandt)",
      expert_words: "Schmidt schickt im Dezember immer zweimal.",
      expert_words_english: "Schmidt always sends it twice in December.",
    }),
    guard({
      id: "g3",
      rule: "Intercompany invoices need a second approval",
      ask_whom: "Controller (M. Weber)",
      expert_words: "Kovotech braucht eine zweite Freigabe.",
      expert_words_english: "",
    }),
  ],
  open_questions: [],
  instructions: "",
};

const GUARD_FOR: Record<JudgmentRule, string> = {
  capex_over_5000: "g1",
  second_december_bill: "g2",
  intercompany_approval: "g3",
};

const oracle: Decide = async (invoice) => {
  const [call] = judgmentCalls(invoice);
  return call
    ? { verdict: "judgment", guardrailId: GUARD_FOR[call.rule], why: call.why }
    : { verdict: "routine" };
};

describe("plan with the oracle", () => {
  const cases: [string, Invoice[], string, Record<string, string>][] = [
    ["expert", DATASETS.expert.invoices, "4474", { "4471": "g1", "4472": "g2", "4473": "g3" }],
    ["newhire", DATASETS.newhire.invoices, "4483", { "4480": "g1", "4481": "g2", "4482": "g3" }],
  ];
  for (const [name, invoices, routine, judged] of cases) {
    it(`posts only the routine invoice and hands the rest to a person (${name})`, async () => {
      const result = await plan(invoices, exp, oracle);
      expect(result.post).toEqual([{ invoiceId: routine, costCenter: "4730" }]);
      expect(result.forYou.map((f) => [f.invoiceId, f.guardrailId])).toEqual(
        Object.entries(judged),
      );
      for (const f of result.forYou) {
        const g = exp.guardrails.find((x) => x.id === f.guardrailId)!;
        expect(f.rule).toBe(g.rule);
        expect(f.askWhom).toBe(g.ask_whom);
        expect(f.expertWords).toBe(g.expert_words_english || g.expert_words);
        expect(f.why).toBe(judgmentCalls(invoices.find((i) => i.id === f.invoiceId)!)[0].why);
      }
      // No judgment call is ever posted.
      const posted = new Set(result.post.map((p) => p.invoiceId));
      for (const inv of invoices) {
        if (judgmentCalls(inv).length) expect(posted.has(inv.id)).toBe(false);
      }
    });
  }

  it("falls back to the expert's own words when there is no English", async () => {
    const result = await plan(DATASETS.expert.invoices, exp, oracle);
    expect(result.forYou.find((f) => f.invoiceId === "4473")!.expertWords).toBe(
      "Kovotech braucht eine zweite Freigabe.",
    );
    expect(result.forYou.find((f) => f.invoiceId === "4471")!.expertWords).toBe(
      "Over five thousand, that's a fixed asset.",
    );
  });
});

describe("plan fails closed", () => {
  const invoices = DATASETS.expert.invoices;

  it("hands an invoice to a person when decide throws or rejects", async () => {
    const decide: Decide = async (inv) => {
      if (inv.id === "4474") throw new Error("network");
      return { verdict: "routine" };
    };
    const result = await plan([invoices[3]], exp, decide);
    expect(result.post).toEqual([]);
    expect(result.forYou).toEqual([
      {
        invoiceId: "4474",
        guardrailId: null,
        rule: "",
        askWhom: "",
        expertWords: "",
        why: COULD_NOT_DECIDE,
      },
    ]);
    const rejected = await plan([invoices[3]], exp, () => Promise.reject(new Error("x")));
    expect(rejected.forYou[0].why).toBe(COULD_NOT_DECIDE);
  });

  it("hands an invoice to a person when the answer isn't a decision", async () => {
    const garbage = [
      null,
      undefined,
      "routine",
      {},
      { verdict: "post" },
      { verdict: "judgment" },
      { verdict: "judgment", guardrailId: 3, why: "x" },
      { verdict: "judgment", guardrailId: "g1", why: null },
    ];
    for (const answer of garbage) {
      const decide = (async () => answer) as unknown as Decide;
      const result = await plan([invoices[3]], exp, decide);
      expect(result.post, JSON.stringify(answer)).toEqual([]);
      expect(result.forYou[0].why).toBe(NOT_CLEAR);
      expect(result.forYou[0].guardrailId).toBeNull();
    }
  });

  it("keeps the agent's reason for a guardrail that isn't in the export", async () => {
    const decide: Decide = async () => ({ verdict: "judgment", guardrailId: "g9", why: "Odd" });
    const result = await plan([invoices[0]], exp, decide);
    expect(result.post).toEqual([]);
    expect(result.forYou).toEqual([
      { invoiceId: "4471", guardrailId: "g9", rule: "", askWhom: "", expertWords: "", why: "Odd" },
    ]);
  });

  it("posts nothing and asks nothing when the Work Map has no guardrails", async () => {
    const decide = vi.fn<Decide>(async () => ({ verdict: "routine" }));
    const result = await plan(invoices, { ...exp, guardrails: [] }, decide);
    expect(decide).not.toHaveBeenCalled();
    expect(result.post).toEqual([]);
    expect(result.forYou.map((f) => f.invoiceId)).toEqual(["4471", "4472", "4473", "4474"]);
    expect(result.forYou.every((f) => f.why === NO_GUARDRAILS)).toBe(true);
  });
});

describe("plan order", () => {
  it("skips invoices that aren't open", async () => {
    const decide = vi.fn<Decide>(async () => ({ verdict: "routine" }));
    const invoices = DATASETS.expert.invoices.map((inv, i) =>
      i % 2 ? { ...inv, status: (i === 1 ? "posted" : "on_hold") as Invoice["status"] } : inv,
    );
    const result = await plan(invoices, exp, decide);
    expect(decide.mock.calls.map(([inv]) => inv.id)).toEqual(["4471", "4473"]);
    expect(result.post.map((p) => p.invoiceId)).toEqual(["4471", "4473"]);
    expect(result.forYou).toEqual([]);
  });

  it("asks one invoice at a time, in order, even when answers come back out of order", async () => {
    let inFlight = 0;
    let most = 0;
    const calls: string[] = [];
    const delay: Record<string, number> = { "4471": 20, "4472": 0, "4473": 10, "4474": 5 };
    const decide: Decide = async (inv, guardrails) => {
      calls.push(inv.id);
      expect(guardrails).toBe(exp.guardrails);
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, delay[inv.id]));
      inFlight--;
      return oracle(inv, guardrails);
    };
    const reversed = [...DATASETS.newhire.invoices].reverse();
    const result = await plan(reversed, exp, decide);
    expect(most).toBe(1);
    expect(calls).toEqual(["4483", "4482", "4481", "4480"]);
    expect(result.post.map((p) => p.invoiceId)).toEqual(["4483"]);
    expect(result.forYou.map((f) => f.invoiceId)).toEqual(["4482", "4481", "4480"]);
  });
});

describe("isDecision", () => {
  it("accepts only well-formed decisions", () => {
    expect(isDecision({ verdict: "routine" })).toBe(true);
    expect(isDecision({ verdict: "judgment", guardrailId: null, why: "" })).toBe(true);
    expect(isDecision({ verdict: "judgment", guardrailId: "g1", why: "x" })).toBe(true);
    expect(isDecision({ verdict: "judgment", guardrailId: "g1" })).toBe(false);
    expect(isDecision({ verdict: "Routine" })).toBe(false);
    expect(isDecision(null)).toBe(false);
    expect(isDecision([])).toBe(false);
  });
});
