import { describe, expect, it } from "vitest";
import {
  compareRows,
  fieldValue,
  followUpState,
  labels,
  pickerGroups,
  questionsFor,
  sameTask,
  words,
} from "./compare";
import type { DiffQuestion, FollowUp, WorkMapDiff, WorkMapSummary } from "./work-maps";

// GET /api/v1/work_map_diff's diff and questions for the backend's test maps
// (core/backend/tests/test_work_map_diff_router.py MAP_A vs MAP_B).
const FIXTURE = {
  diff: {
    steps: {
      same: [
        { a: "s1", b: "s1", title: "Open the invoice", score: 0.667 },
        { a: "s3", b: "s4", title: "Approve the invoice for payment", score: 1.0 },
      ],
      differs: [
        {
          a: "s2",
          b: "s3",
          title_a: "Code the cost account",
          title_b: "Code the cost account",
          score: 1.0,
          fields: [
            {
              field: "reason",
              kind: "changed",
              a: "equipment over 5,000 is capex",
              b: "equipment over 10,000 is capex",
            },
          ],
          words_a: {
            quote: "Ausrüstung über 5.000 ist immer Anlagevermögen.",
            quote_translation: "Equipment over 5,000 is always capex.",
            reason: "equipment over 5,000 is capex",
          },
          words_b: {
            quote: "Equipment over 10,000 is always capex.",
            quote_translation: "",
            reason: "equipment over 10,000 is capex",
          },
        },
      ],
      only_a: [],
      only_b: [
        {
          id: "s2",
          title: "Check the supplier against the approved vendor list",
          words: {
            quote: "We never pay a vendor that isn't on the list.",
            quote_translation: "",
            reason: "we never pay a vendor that isn't approved",
          },
        },
      ],
    },
    guardrails: {
      same: [],
      differs: [
        {
          a: "g1",
          b: "g1",
          title_a: "Equipment over 5,000 goes to capex account 0400.",
          title_b: "Equipment over 10,000 goes to capex account 0400.",
          score: 1.0,
          fields: [
            { field: "numbers", kind: "changed", a: ["0400", "5000"], b: ["0400", "10000"] },
          ],
          words_a: { quote: "", quote_translation: "", reason: "" },
          words_b: { quote: "", quote_translation: "", reason: "" },
        },
      ],
      only_a: [],
      only_b: [],
    },
  },
  questions: {
    a: [
      {
        id: "guardrails:g1:g1:numbers",
        section: "guardrails",
        item: "g1",
        other: "g1",
        field: "numbers",
        text: 'On "Equipment over 5,000 goes to capex account 0400", you went with 0400 and 5,000; in another session it was 0400 and 10,000. Which holds, and when?',
        quote: "",
      },
      {
        id: "steps:s2:s3:reason",
        section: "steps",
        item: "s2",
        other: "s3",
        field: "reason",
        text: 'You said "Equipment over 5,000 is always capex." Your reason was "equipment over 5,000 is capex"; in another session it was "equipment over 10,000 is capex". Which matters more here?',
        quote: "Equipment over 5,000 is always capex.",
      },
    ],
    b: [
      {
        id: "guardrails:g1:g1:numbers",
        section: "guardrails",
        item: "g1",
        other: "g1",
        field: "numbers",
        text: 'On "Equipment over 10,000 goes to capex account 0400", you went with 0400 and 10,000; in another session it was 0400 and 5,000. Which holds, and when?',
        quote: "",
      },
      {
        id: "steps:-:s2:only",
        section: "steps",
        item: "s2",
        other: null,
        field: "only",
        text: 'You said "We never pay a vendor that isn\'t on the list." You did "Check the supplier against the approved vendor list"; in another session this step wasn\'t there. When is it needed?',
        quote: "We never pay a vendor that isn't on the list.",
      },
      {
        id: "steps:s2:s3:reason",
        section: "steps",
        item: "s3",
        other: "s2",
        field: "reason",
        text: 'You said "Equipment over 10,000 is always capex." Your reason was "equipment over 10,000 is capex"; in another session it was "equipment over 5,000 is capex". Which matters more here?',
        quote: "Equipment over 10,000 is always capex.",
      },
    ],
  },
} as unknown as {
  diff: WorkMapDiff;
  questions: { a: DiffQuestion[]; b: DiffQuestion[] };
};

const summary = (id: string, task: string | null, recorded_at: string | null): WorkMapSummary => ({
  id,
  task,
  recorded_at,
  confirmed: true,
  steps: 3,
  guardrails: 1,
  open_questions: 0,
});

describe("sameTask", () => {
  it("ignores case and extra spaces", () => {
    expect(sameTask("Code a supplier invoice", "  code a  SUPPLIER invoice ")).toBe(true);
    expect(sameTask("发票 编码", "发票 编码")).toBe(true);
    expect(sameTask("Code an invoice", "Pay an invoice")).toBe(false);
  });

  it("never matches sessions without a task", () => {
    expect(sameTask(null, null)).toBe(false);
    expect(sameTask("", "  ")).toBe(false);
    expect(sameTask(null, "Code an invoice")).toBe(false);
  });
});

describe("pickerGroups", () => {
  const maps = [
    summary("a", "Code an invoice", "2026-10-01T10:00:00Z"),
    summary("old", "code an  invoice", "2026-09-01T10:00:00Z"),
    summary("other", "Pay an invoice", "2026-10-03T10:00:00Z"),
    summary("new", "Code an invoice", "2026-10-02T10:00:00Z"),
    summary("untimed", null, null),
  ];

  it("puts sessions of A's task first, newest first, without A itself", () => {
    const groups = pickerGroups(maps, "a");
    expect(groups.sameTask.map((m) => m.id)).toEqual(["new", "old"]);
    expect(groups.otherTasks.map((m) => m.id)).toEqual(["other", "untimed"]);
  });

  it("lists everything as other tasks when A is unknown", () => {
    const groups = pickerGroups(maps, undefined);
    expect(groups.sameTask).toEqual([]);
    expect(groups.otherTasks.map((m) => m.id)).toEqual(["other", "new", "a", "old", "untimed"]);
  });
});

describe("compareRows", () => {
  const rows = compareRows(FIXTURE.diff);

  it("shows differing numbers with separators and keeps account codes", () => {
    const guard = rows.guardrails.find((r) => r.kind === "differs")!;
    expect(guard.titleA).toBe("Equipment over 5,000 goes to capex account 0400.");
    expect(guard.titleB).toBe("Equipment over 10,000 goes to capex account 0400.");
    expect(guard.fields).toEqual([
      { field: "numbers", label: "Numbers", a: "0400, 5,000", b: "0400, 10,000", kind: "changed" },
    ]);
    expect(guard.wordsA).toBe("");
  });

  it("prefers the English translation of the expert's words", () => {
    const step = rows.steps.find((r) => r.kind === "differs")!;
    expect(step.wordsA).toBe("Equipment over 5,000 is always capex.");
    expect(step.wordsB).toBe("Equipment over 10,000 is always capex.");
    expect(step.fields[0]).toMatchObject({
      label: "Reason",
      a: "equipment over 5,000 is capex",
      b: "equipment over 10,000 is capex",
    });
  });

  it("keeps a step only session B did, and the same steps as one line", () => {
    expect(rows.steps.map((r) => r.kind)).toEqual(["differs", "only_b", "same", "same"]);
    expect(rows.steps.find((r) => r.kind === "only_b")).toMatchObject({
      titleA: "",
      titleB: "Check the supplier against the approved vendor list",
      wordsB: "We never pay a vendor that isn't on the list.",
      fields: [],
    });
    expect(rows.steps.filter((r) => r.kind === "same").map((r) => r.titleA)).toEqual([
      "Open the invoice",
      "Approve the invoice for payment",
    ]);
  });

  it("copes with missing sections and lists", () => {
    expect(compareRows(null)).toEqual({ steps: [], guardrails: [] });
    expect(compareRows({})).toEqual({ steps: [], guardrails: [] });
    const partial = { steps: { only_a: [{ id: "s9", title: "Call the supplier" }] } };
    expect(compareRows(partial as unknown as WorkMapDiff).steps).toEqual([
      {
        kind: "only_a",
        key: "only_a:s9",
        titleA: "Call the supplier",
        titleB: "",
        fields: [],
        wordsA: "",
        wordsB: "",
      },
    ]);
  });
});

describe("fieldValue", () => {
  it("puts each kind of value in words", () => {
    expect(fieldValue("judgment", true)).toBe("Judgment call");
    expect(fieldValue("judgment", false)).toBe("Routine");
    expect(fieldValue("kind", "stop_and_ask")).toBe("Stop and ask");
    expect(fieldValue("guardrails", ["g1", "g2"])).toBe("g1, g2");
    expect(fieldValue("ask_whom", null)).toBe("Not said");
    expect(fieldValue("applies_when", "")).toBe("Not said");
    expect(fieldValue("numbers", [])).toBe("Not said");
    expect(fieldValue("numbers", ["0", "2.5", "1250000"])).toBe("0, 2.5, 1,250,000");
  });

  const names = {
    steps: { s2: "Code the cost account" },
    guardrails: {
      g1: "Over 5,000 is capex",
      g3: "  Ask the controller before booking anything to an account you have never used  ",
    },
  };

  it("names a step's rules by their texts, quoted and cut to 60 characters", () => {
    expect(fieldValue("guardrails", ["g1", "g3"], names)).toBe(
      "“Over 5,000 is capex”, “Ask the controller before booking anything to an account you…”",
    );
    expect(fieldValue("guardrails", ["g1", "g9"], names)).toBe("“Over 5,000 is capex”, g9");
    expect(fieldValue("guardrails", [], names)).toBe("Not said");
    expect(fieldValue("guardrails", null, names)).toBe("Not said");
  });

  it("names a guardrail's step by its title", () => {
    expect(fieldValue("step", "s2", names)).toBe("Code the cost account");
    expect(fieldValue("step", "s7", names)).toBe("s7");
    expect(fieldValue("step", "s2")).toBe("s2");
    expect(fieldValue("step", null, names)).toBe("Not said");
  });
});

describe("labels", () => {
  it("names each side's own ids from the same, differing and one-side lists", () => {
    expect(labels(FIXTURE.diff, "a")).toEqual({
      steps: {
        s1: "Open the invoice",
        s3: "Approve the invoice for payment",
        s2: "Code the cost account",
      },
      guardrails: { g1: "Equipment over 5,000 goes to capex account 0400." },
    });
    expect(labels(FIXTURE.diff, "b")).toEqual({
      steps: {
        s1: "Open the invoice",
        s4: "Approve the invoice for payment",
        s3: "Code the cost account",
        s2: "Check the supplier against the approved vendor list",
      },
      guardrails: { g1: "Equipment over 10,000 goes to capex account 0400." },
    });
  });

  it('skips blank titles and the id "-"', () => {
    const diff = {
      steps: {
        same: [{ a: "s1", b: "s1", title: "  " }],
        differs: [{ a: "-", b: "s2", title_a: "Lost", title_b: "Pay" }],
        only_a: [
          { id: "s5", title: "" },
          { id: null, title: "No id" },
        ],
      },
    } as unknown as WorkMapDiff;
    expect(labels(diff, "a")).toEqual({ steps: {}, guardrails: {} });
    expect(labels(diff, "b")).toEqual({ steps: { s2: "Pay" }, guardrails: {} });
  });

  it("copes with missing sections and lists", () => {
    expect(labels(null, "a")).toEqual({ steps: {}, guardrails: {} });
    expect(labels({}, "b")).toEqual({ steps: {}, guardrails: {} });
    expect(labels({ steps: { same: null } } as unknown as WorkMapDiff, "a")).toEqual({
      steps: {},
      guardrails: {},
    });
  });
});

describe("compareRows with ids in fields", () => {
  // The fixture, with a step whose rules differ and a guardrail that moved to another step.
  const diff = structuredClone(FIXTURE.diff);
  diff.steps.differs[0].fields.push({
    field: "guardrails",
    kind: "changed",
    a: ["g1"],
    b: [],
  });
  diff.guardrails.differs[0].fields.push({ field: "step", kind: "changed", a: "s2", b: "s3" });
  const rows = compareRows(diff);

  it("shows rule texts instead of guardrail ids on a step", () => {
    const step = rows.steps.find((r) => r.kind === "differs")!;
    expect(step.fields.find((f) => f.field === "guardrails")).toEqual({
      field: "guardrails",
      label: "Rules on this step",
      a: "“Equipment over 5,000 goes to capex account 0400.”",
      b: "Not said",
      kind: "changed",
    });
  });

  it("shows each side's step title instead of its step id on a guardrail", () => {
    const guard = rows.guardrails.find((r) => r.kind === "differs")!;
    expect(guard.fields.find((f) => f.field === "step")).toMatchObject({
      label: "Step",
      a: "Code the cost account",
      b: "Code the cost account",
    });
  });
});

describe("words", () => {
  it("falls back from translation to quote to reason", () => {
    expect(words({ quote: "Nie.", quote_translation: "Never.", reason: "r" })).toBe("Never.");
    expect(words({ quote: "Never.", quote_translation: "", reason: "r" })).toBe("Never.");
    expect(words({ quote: "", quote_translation: "", reason: "r" })).toBe("r");
    expect(words(undefined)).toBe("");
  });
});

describe("questionsFor", () => {
  it("returns each expert's questions as the backend sent them", () => {
    expect(questionsFor(FIXTURE, "a")).toEqual(FIXTURE.questions.a);
    expect(questionsFor(FIXTURE, "b")).toEqual(FIXTURE.questions.b);
  });

  it("has none when the backend sent no questions", () => {
    expect(questionsFor({}, "a")).toEqual([]);
    expect(questionsFor({ questions: null }, "b")).toEqual([]);
    expect(questionsFor({ questions: { a: [] } }, "b")).toEqual([]);
    expect(questionsFor(null, "a")).toEqual([]);
  });
});

describe("followUpState", () => {
  const q = (id: string): DiffQuestion => ({
    id,
    section: "guardrails",
    item: "g1",
    other: "g1",
    field: "numbers",
    text: "Why?",
    quote: "",
  });
  const waiting = (question_id: string): FollowUp => ({
    question_id,
    text: "Why?",
    quote: "",
    from: "b",
    added_at: "2026-10-04T10:00:00+00:00",
  });

  it("marks the questions already kept as waiting", () => {
    expect(followUpState([q("x"), q("y")], [waiting("y"), waiting("gone")])).toEqual({
      x: "can_ask",
      y: "waiting",
    });
  });

  it("can ask everything while nothing is known to be waiting", () => {
    expect(followUpState([q("x")], null)).toEqual({ x: "can_ask" });
    expect(followUpState([q("x")], undefined)).toEqual({ x: "can_ask" });
    expect(followUpState([], [waiting("x")])).toEqual({});
  });
});
