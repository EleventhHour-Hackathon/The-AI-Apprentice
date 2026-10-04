import { describe, expect, it, vi } from "vitest";
import type { AgentExport, ExportGuardrail, Plan } from "./autopilot";
import { COULD_NOT_DECIDE } from "./autopilot";
import {
  AutopilotUnavailable,
  applyPlan,
  decideRemote,
  runAutopilot,
  toDecideBody,
} from "./autopilot-api";
import { DATASETS, HISTORY, type Invoice } from "./sandbox";
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
    guard({ id: "g1", kind: "limit", action: "enforce", rule: "Over €5,000 is capex" }),
    guard({ id: "g2", rule: "Schmidt bills December twice", ask_whom: "Head of Finance" }),
    guard({ id: "g3", rule: "Intercompany needs a second approval", ask_whom: "Controller" }),
  ],
  open_questions: [],
  instructions: "",
};

const GUARD_FOR: Record<JudgmentRule, string> = {
  capex_over_5000: "g1",
  second_december_bill: "g2",
  intercompany_approval: "g3",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Fetch = typeof fetch;
const fetchOf = (respond: (init: RequestInit) => Response | Promise<Response>) =>
  vi.fn<Fetch>(async (_url, init) => respond(init ?? {}));

/** A backend whose agent answers like the oracle. */
const oracleFetch = () =>
  fetchOf((init) => {
    const { invoice } = JSON.parse(String(init.body)) as { invoice: Invoice };
    const all = [...DATASETS.expert.invoices, ...DATASETS.newhire.invoices];
    const full = all.find((i) => i.id === invoice.id)!;
    const [call] = judgmentCalls({ ...full, ...invoice });
    return json(
      200,
      call
        ? { verdict: "judgment", guardrailId: GUARD_FOR[call.rule], why: call.why }
        : { verdict: "routine" },
    );
  });

const inv = DATASETS.expert.invoices[0]!;

describe("toDecideBody", () => {
  it("drops the contact, status and note and adds the cost center's name", () => {
    const body = toDecideBody(inv);
    expect(body.invoice).not.toHaveProperty("contact");
    expect(body.invoice).not.toHaveProperty("status");
    expect(body.invoice).not.toHaveProperty("note");
    expect(body.invoice.costCenterName).toBe("Maintenance & small equipment");
    expect(JSON.stringify(body)).not.toContain(inv.contact.iban);
    expect(JSON.stringify(body)).not.toContain(inv.contact.email);
  });

  it("sends only the same supplier's earlier invoices", () => {
    const schmidt = DATASETS.expert.invoices[1]!;
    const body = toDecideBody(schmidt);
    expect(body.history.map((h) => h.id)).toEqual(["3988", "3996", "4466"]);
    expect(body.history[0]).toEqual({ id: "3988", date: "2025-12-08", amount: 1180, note: "Paid" });
    const self = [...HISTORY, { ...HISTORY[0]!, id: schmidt.id }];
    expect(toDecideBody(schmidt, self).history.map((h) => h.id)).not.toContain(schmidt.id);
  });
});

describe("decideRemote", () => {
  it("posts to the Work Map's decide endpoint and returns a routine decision", async () => {
    const fetchImpl = fetchOf(() => json(200, { verdict: "routine" }));
    const decide = decideRemote("wm 1/x", { fetchImpl });
    await expect(decide(inv, [])).resolves.toEqual({ verdict: "routine" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/v1\/work_maps\/wm%201%2Fx\/decide$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(toDecideBody(inv));
  });

  it("returns a judgment", async () => {
    const answer = { verdict: "judgment", guardrailId: "g1", why: "Over 5,000" };
    const decide = decideRemote("wm", { fetchImpl: fetchOf(() => json(200, answer)) });
    await expect(decide(inv, [])).resolves.toEqual(answer);
  });

  it("throws on an answer that isn't a decision", async () => {
    const decide = decideRemote("wm", {
      fetchImpl: fetchOf(() => json(200, { verdict: "post" })),
    });
    await expect(decide(inv, [])).rejects.toThrow();
  });

  it("throws on a server error", async () => {
    const decide = decideRemote("wm", { fetchImpl: fetchOf(() => json(500, { detail: "x" })) });
    await expect(decide(inv, [])).rejects.not.toBeInstanceOf(AutopilotUnavailable);
    await expect(decide(inv, [])).rejects.toThrow("500");
  });

  it("throws AutopilotUnavailable with the backend's reason on a 503", async () => {
    const detail = "Couldn't reach OpenAI, so the autopilot can't decide. Nothing was posted.";
    const decide = decideRemote("wm", { fetchImpl: fetchOf(() => json(503, { detail })) });
    const error = await decide(inv, []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AutopilotUnavailable);
    expect((error as Error).message).toBe(detail);
  });

  it("gives up after the timeout", async () => {
    const fetchImpl = vi.fn<Fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const decide = decideRemote("wm", { fetchImpl, timeoutMs: 10 });
    await expect(decide(inv, [])).rejects.toThrow("aborted");
  });
});

describe("runAutopilot and applyPlan", () => {
  const cases: [string, Invoice[], string][] = [
    ["expert", DATASETS.expert.invoices, "4474"],
    ["newhire", DATASETS.newhire.invoices, "4483"],
  ];
  for (const [name, invoices, routine] of cases) {
    it(`posts only ${routine} and hands the rest to a person (${name})`, async () => {
      const fetchImpl = oracleFetch();
      const { plan, unavailable } = await runAutopilot(
        invoices,
        exp,
        decideRemote("wm", { fetchImpl }),
      );
      expect(unavailable).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      const { invoices: after, log } = applyPlan(invoices, plan, "09:30");
      expect(after.filter((i) => i.status === "posted").map((i) => i.id)).toEqual([routine]);
      expect(after.filter((i) => i.status === "open").map((i) => i.id)).toEqual(
        invoices.map((i) => i.id).filter((id) => id !== routine),
      );
      expect(plan.forYou.map((f) => f.invoiceId)).toEqual(
        invoices.map((i) => i.id).filter((id) => id !== routine),
      );
      expect(plan.forYou.every((f) => f.rule && f.why)).toBe(true);
      expect(log).toEqual([
        {
          at: "09:30",
          text: `Invoice ${routine} posted by the autopilot to 4730 Office & supplies`,
        },
      ]);
    });
  }

  it("posts nothing and stops asking once the agent is unavailable", async () => {
    const detail = "The autopilot needs an OpenAI key (OPENAI_API_KEY) on the backend.";
    const fetchImpl = fetchOf(() => json(503, { detail }));
    const invoices = DATASETS.expert.invoices;
    const { plan, unavailable } = await runAutopilot(
      invoices,
      exp,
      decideRemote("wm", { fetchImpl }),
    );
    expect(unavailable).toBe(detail);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(plan.post).toEqual([]);
    expect(plan.forYou.map((f) => [f.invoiceId, f.why])).toEqual(
      invoices.map((i) => [i.id, COULD_NOT_DECIDE]),
    );
    expect(applyPlan(invoices, plan, "09:30").log).toEqual([]);
  });

  it("skips an invoice that was posted or recoded since the plan was made", () => {
    const invoices = DATASETS.expert.invoices;
    const p: Plan = {
      post: [
        { invoiceId: "4471", costCenter: "4711" },
        { invoiceId: "4472", costCenter: "4720" },
        { invoiceId: "4474", costCenter: "4730" },
      ],
      forYou: [],
    };
    const changed = invoices.map((i) =>
      i.id === "4471"
        ? { ...i, costCenter: "0400" }
        : i.id === "4472"
          ? { ...i, status: "on_hold" as const, note: "Possible duplicate" }
          : i,
    );
    const { invoices: after, log } = applyPlan(changed, p, "10:00");
    expect(after[0]).toBe(changed[0]);
    expect(after[1]).toBe(changed[1]);
    expect(after[2]).toBe(changed[2]);
    expect(after[3]!.status).toBe("posted");
    expect(log.map((l) => l.text)).toEqual([
      "Invoice 4474 posted by the autopilot to 4730 Office & supplies",
    ]);
  });

  it("logs newest first", () => {
    const invoices = DATASETS.expert.invoices;
    const p: Plan = {
      post: [
        { invoiceId: "4471", costCenter: "4711" },
        { invoiceId: "4474", costCenter: "4730" },
      ],
      forYou: [],
    };
    expect(applyPlan(invoices, p, "10:00").log.map((l) => l.text.split(" ")[1])).toEqual([
      "4474",
      "4471",
    ]);
  });
});
