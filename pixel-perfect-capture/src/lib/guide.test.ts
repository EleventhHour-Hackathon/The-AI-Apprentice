import { describe, expect, it } from "vitest";
import { AccessKeyError } from "./backend";
import {
  focusCue,
  focusedStep,
  guideError,
  hasStep,
  nextStepId,
  spokenRecently,
  stepForGuide,
  workMapText,
} from "./guide";

// The map from core/backend/tests/test_tutor_report.py, so the text matches tutor.work_map_text.
const MAP = {
  steps: [
    {
      id: "s1",
      title: "Open the invoice",
      quote: "Ich mache erst mal die Rechnung auf.",
      quote_kind: "narration",
      quote_translation: "First I open the invoice.",
    },
    {
      id: "s2",
      title: "Code the cost account",
      judgment: true,
      decision: "Coded the laptop to capex 0400.",
      reason: "because equipment over 5,000 is capex",
      quote: "Over 5,000 it's always capex.",
    },
    {
      id: "s3",
      title: "Check the VAT id",
      decision: "Looked up the VAT id.",
      reason: "because the auditors check it",
      quote: "Jetzt die USt-ID.",
      quote_kind: "narration",
    },
    { id: "s4", title: "Approve the invoice" },
  ],
  guardrails: [
    {
      id: "g1",
      kind: "limit",
      rule: "Equipment over 5,000 goes to capex",
      step: "s2",
      applies_when: "the invoice is for equipment",
      quote: "Über 5.000 immer Anlagevermögen.",
      quote_translation: "Over 5,000 always fixed assets.",
    },
    { kind: "stop_and_ask", rule: "No VAT id, no approval", ask_whom: "the controller" },
  ],
};

describe("workMapText", () => {
  it("is the backend's tutor.work_map_text", () => {
    expect(workMapText(MAP)).toBe(
      [
        "STEPS (in order)",
        "s1. Open the invoice",
        '   Said while doing it (not a reason): "Ich mache erst mal die Rechnung auf." (in English: "First I open the invoice.")',
        "s2. Code the cost account [judgment call]",
        "   Decision the expert made on their case: Coded the laptop to capex 0400.",
        "   Expert's words: \"Over 5,000 it's always capex.\"",
        "s3. Check the VAT id",
        "   Decision the expert made on their case: Looked up the VAT id.",
        "   Reason: because the auditors check it",
        '   Said while doing it (not a reason): "Jetzt die USt-ID."',
        "s4. Approve the invoice",
        "\nGUARDRAILS",
        "g1. Limit: Equipment over 5,000 goes to capex (step s2)",
        "   Applies when: the invoice is for equipment",
        '   Expert\'s words: "Über 5.000 immer Anlagevermögen." (in English: "Over 5,000 always fixed assets.")',
        "g2. Stop and ask: No VAT id, no approval",
        "   Ask: the controller",
      ].join("\n"),
    );
  });

  it("labels an assumed reason", () => {
    const map = {
      steps: [{ id: "s1", title: "Match", reason: "standard practice", reason_source: "inferred" }],
      guardrails: [],
    };
    expect(workMapText(map)).toContain("s1. Match\n   Assumed reason: standard practice");
  });

  it("says (none) for an empty map", () => {
    expect(workMapText({ steps: [], guardrails: [] })).toBe(
      "STEPS (in order)\n\nGUARDRAILS\n(none)",
    );
  });
});

describe("focusedStep", () => {
  it("names the step or guardrail in focus", () => {
    expect(focusedStep(MAP, { kind: "step", id: "s3" })).toBe("s3. Check the VAT id");
    expect(focusedStep(MAP, { kind: "guardrail", id: "g2" })).toBe("g2. No VAT id, no approval");
  });

  it("is none without a focus or for an unknown id", () => {
    expect(focusedStep(MAP, null)).toBe("none");
    expect(focusedStep(MAP, { kind: "step", id: "s9" })).toBe("none");
  });
});

describe("nextStepId", () => {
  it("starts at the first step and walks in order", () => {
    expect(nextStepId(MAP, null)).toBe("s1");
    expect(nextStepId(MAP, { kind: "step", id: "s1" })).toBe("s2");
    expect(nextStepId(MAP, { kind: "step", id: "s4" })).toBeNull();
  });

  it("goes on after a guardrail's step", () => {
    expect(nextStepId(MAP, { kind: "guardrail", id: "g1" })).toBe("s3");
    expect(nextStepId(MAP, { kind: "guardrail", id: "g2" })).toBe("s1");
  });

  it("knows which steps exist", () => {
    expect(hasStep(MAP, "s2")).toBe(true);
    expect(hasStep(MAP, "g1")).toBe(false);
  });
});

describe("stepForGuide", () => {
  it("gives the step with its guardrails", () => {
    expect(stepForGuide(MAP, "s2")).toBe(
      [
        "Step 2 of 4, now shown on the map:",
        "s2. Code the cost account [judgment call]",
        "   Decision the expert made on their case: Coded the laptop to capex 0400.",
        "   Expert's words: \"Over 5,000 it's always capex.\"",
        "g1. Limit: Equipment over 5,000 goes to capex (step s2)",
        "   Applies when: the invoice is for equipment",
        '   Expert\'s words: "Über 5.000 immer Anlagevermögen." (in English: "Over 5,000 always fixed assets.")',
      ].join("\n"),
    );
  });

  it("says when there are no more steps", () => {
    expect(stepForGuide(MAP, null)).toBe("There are no more steps. The walk-through is done.");
  });
});

describe("focusCue", () => {
  it("is the cue the guide's prompt reads", () => {
    expect(focusCue("s3")).toBe("[FOCUS step=s3]");
  });
});

describe("spokenRecently", () => {
  it("keeps words the person said lately, in any script", () => {
    expect(spokenRecently("make it ten thousand", ["Hmm.", "Make it ten thousand, please."])).toBe(
      "make it ten thousand",
    );
    expect(spokenRecently("改成一万", ["我觉得改成一万。"])).toBe("改成一万");
  });

  it("drops words they didn't say", () => {
    expect(spokenRecently("make it twenty", ["Make it ten thousand."])).toBe("");
    expect(spokenRecently("", ["Anything."])).toBe("");
  });
});

describe("guideError", () => {
  it("says what went wrong in words", () => {
    expect(guideError(new DOMException("denied", "NotAllowedError"))).toMatch(/microphone/);
    expect(guideError(new DOMException("none", "NotFoundError"))).toMatch(/No microphone/);
    expect(guideError(new AccessKeyError())).toMatch(/Access key/);
    expect(guideError(new TypeError("Failed to fetch"))).toMatch(/Couldn't reach/);
    expect(guideError(new Error("token request answered 503"))).toBe(
      "Couldn't start Sia. token request answered 503",
    );
  });
});
