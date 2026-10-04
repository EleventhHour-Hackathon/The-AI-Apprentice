import { describe, expect, it } from "vitest";
import { decideFloor, type FloorInput } from "./floor";

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
