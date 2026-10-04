import { describe, expect, it } from "vitest";
import { decideFloor, decideWrapUp, type FloorInput, type WrapUpInput } from "./floor";

const MIN = 60_000;
// Five minutes in, after a step, with everything quiet: the moment to ask.
const ready: FloorInput = {
  now: 5 * MIN,
  observingSince: 0,
  speaking: false,
  lastSpeechAt: 5 * MIN - 10_000,
  lastActivityAt: 5 * MIN - 10_000,
  agentSpeaking: false,
  pending: [{ at: 5 * MIN - 12_000, kind: "action" }],
  questionTimes: [],
  lastPauseAt: -Infinity,
};

describe("decideFloor", () => {
  it("asks at a pause after a step", () => {
    expect(decideFloor(ready)).toBe("ask");
  });

  it("stays quiet while the expert talks, and for a moment after", () => {
    expect(decideFloor({ ...ready, speaking: true })).toBe("talking");
    expect(decideFloor({ ...ready, lastSpeechAt: ready.now - 1000 })).toBe("talking");
  });

  it("stays quiet while the screen is moving (typing, scrolling)", () => {
    expect(decideFloor({ ...ready, lastActivityAt: ready.now - 500 })).toBe("busy");
  });

  it("gives them time to read what just opened", () => {
    const opened = {
      ...ready,
      pending: [...ready.pending, { at: ready.now - 3000, kind: "navigation" as const }],
    };
    expect(decideFloor(opened)).toBe("reading");
    expect(
      decideFloor({ ...opened, now: ready.now + 6000, lastSpeechAt: 0, lastActivityAt: 0 }),
    ).toBe("ask");
  });

  it("asks about what they opened until three questions are asked, then only after actions", () => {
    const looked = { ...ready, pending: [{ at: 0, kind: "navigation" as const }] };
    expect(decideFloor(looked)).toBe("ask");
    const three = [1, 2, 3].map((m) => m * MIN);
    expect(decideFloor({ ...looked, questionTimes: three })).toBe("quiet");
    expect(decideFloor({ ...ready, pending: [] })).toBe("quiet");
  });

  it("does not talk over the agent", () => {
    expect(decideFloor({ ...ready, agentSpeaking: true })).toBe("quiet");
  });

  it("asks less: waits after the start, between questions and after a passed pause", () => {
    expect(decideFloor({ ...ready, observingSince: ready.now - 10_000 })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: [ready.now - 30_000] })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: [ready.now - 45_000] })).toBe("ask");
    expect(decideFloor({ ...ready, lastPauseAt: ready.now - 5000 })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: [ready.now - 2 * MIN] })).toBe("ask");
  });

  it("has no upper limit, but spaces questions out more after the first three", () => {
    const five = [1, 2, 3, 3.5, 4].map((m) => m * MIN);
    expect(decideFloor({ ...ready, questionTimes: five, now: 4 * MIN + 60_000 })).toBe("waiting");
    expect(decideFloor({ ...ready, questionTimes: five, now: 4 * MIN + 80_000 })).toBe("ask");
  });
});

// Just after End: one question was requested 30 s ago, asked, answered, and it's quiet now.
const wrap: WrapUpInput = {
  now: 100_000,
  speaking: false,
  agentSpeaking: false,
  lastSpeechAt: 95_000,
  agentDoneAt: 96_000,
  grant: "answer",
  floorOpenUntil: 0,
  lastPauseAt: 70_000,
  last: { at: 72_000, kind: "reason" },
  met: false,
  prompts: 1,
  limit: 3,
};

describe("decideWrapUp", () => {
  it("asks the next missing question once the answer is in and it's quiet", () => {
    expect(decideWrapUp(wrap)).toBe("ask");
  });

  it("goes to the debrief once enough questions, one about a guardrail, are asked", () => {
    expect(decideWrapUp({ ...wrap, met: true })).toBe("finish");
  });

  it("goes to the debrief when the tries run out", () => {
    expect(decideWrapUp({ ...wrap, prompts: 3 })).toBe("finish");
  });

  it("waits while anyone talks, and for a moment after", () => {
    expect(decideWrapUp({ ...wrap, speaking: true })).toBe("wait");
    expect(decideWrapUp({ ...wrap, agentSpeaking: true })).toBe("wait");
    expect(decideWrapUp({ ...wrap, lastSpeechAt: wrap.now - 1000 })).toBe("wait");
  });

  it("waits for the question's label, which decides the guardrail", () => {
    expect(decideWrapUp({ ...wrap, last: { at: 72_000, kind: "pending" } })).toBe("wait");
  });

  it("waits while the requested question may still come, then asks again", () => {
    const requested = {
      ...wrap,
      grant: "pause" as const,
      lastPauseAt: 90_000,
      floorOpenUntil: 105_000,
    };
    expect(decideWrapUp(requested)).toBe("wait");
    expect(decideWrapUp({ ...requested, now: 106_000 })).toBe("ask");
  });

  it("waits for an answer, but not forever", () => {
    const unanswered = { ...wrap, lastSpeechAt: 60_000, agentDoneAt: 96_000 };
    expect(decideWrapUp(unanswered)).toBe("wait");
    expect(decideWrapUp({ ...unanswered, now: 117_000 })).toBe("ask");
  });

  it("asks again at once when the reply to the request was not a question", () => {
    expect(decideWrapUp({ ...wrap, last: { at: 50_000, kind: "reason" } })).toBe("ask");
  });
});
