import { BroadcastChannel as NodeChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import {
  CONFIRM_WAIT_MS,
  FRAME_LAG_MS,
  HOLD_TTL_MS,
  NO_SIGNALS,
  applyMessage,
  decideConfirm,
  isHeld,
  isWatching,
  parseHold,
  publishChecked,
  publishHold,
  publishWatching,
  subscribeHold,
  type ConfirmInput,
  type HoldMessage,
  type TutorMessage,
} from "./tutor-hold";

const Ctor = NodeChannel as unknown as Parameters<typeof publishHold>[1];
const flag = { step: "s2", what_happened: "Posted to an opex cost center" };
const hold = (flags: HoldMessage["flags"], at: number): HoldMessage => ({
  type: "hold",
  flags,
  at,
});
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("parseHold", () => {
  it("accepts a hold", () => {
    expect(parseHold({ type: "hold", flags: [flag], at: 5 })).toEqual(hold([flag], 5));
    expect(parseHold({ type: "hold", flags: [], at: 5 })).toEqual(hold([], 5));
  });

  it("accepts watching, watching off and checked", () => {
    expect(parseHold({ type: "watching", at: 5 })).toEqual({ type: "watching", at: 5 });
    expect(parseHold({ type: "watching", at: 5, off: true })).toEqual({
      type: "watching",
      at: 5,
      off: true,
    });
    // Anything but `off: true` is a plain heartbeat.
    expect(parseHold({ type: "watching", at: 5, off: "yes" })).toEqual({ type: "watching", at: 5 });
    expect(parseHold({ type: "checked", seen: 3, at: 5 })).toEqual({
      type: "checked",
      seen: 3,
      at: 5,
    });
  });

  it("rejects anything else", () => {
    for (const bad of [
      null,
      "hold",
      42,
      { type: "other", flags: [], at: 1 },
      { type: "hold", flags: [], at: "1" },
      { type: "hold", flags: [], at: Number.NaN },
      { type: "hold", flags: "s2", at: 1 },
      { type: "hold", at: 1 },
      { type: "hold", flags: [{ step: "s2" }], at: 1 },
      { type: "hold", flags: [null], at: 1 },
      { type: "watching" },
      { type: "watching", at: "1" },
      { type: "watching", off: true },
      { type: "checked", at: 1 },
      { type: "checked", seen: "3", at: 1 },
      { type: "checked", seen: 3 },
    ])
      expect(parseHold(bad)).toBeNull();
  });
});

describe("isHeld and isWatching", () => {
  it("is not held without a hold or without flags", () => {
    expect(isHeld(null, 1000)).toBe(false);
    expect(isHeld(hold([], 1000), 1000)).toBe(false);
  });

  it("is held while fresh, and lapses after the TTL", () => {
    expect(isHeld(hold([flag], 1000), 1000)).toBe(true);
    expect(isHeld(hold([flag], 1000), 1000 + HOLD_TTL_MS - 1)).toBe(true);
    expect(isHeld(hold([flag], 1000), 1000 + HOLD_TTL_MS)).toBe(false);
  });

  it("watches while the heartbeat is fresh", () => {
    expect(isWatching(null, 1000)).toBe(false);
    expect(isWatching(1000, 1000 + HOLD_TTL_MS - 1)).toBe(true);
    expect(isWatching(1000, 1000 + HOLD_TTL_MS)).toBe(false);
  });
});

describe("applyMessage", () => {
  it("keeps the last hold, the heartbeat and the newest checked frame", () => {
    let s = applyMessage(NO_SIGNALS, { type: "watching", at: 100 });
    expect(s.watchingAt).toBe(100);
    s = applyMessage(s, hold([flag], 200));
    expect(s.last).toEqual(hold([flag], 200));
    s = applyMessage(s, { type: "checked", seen: 300, at: 400 });
    s = applyMessage(s, { type: "checked", seen: 250, at: 450 });
    expect(s.checkedSeen).toBe(300);
  });

  it("stops watching at once when the lesson ends", () => {
    const live = applyMessage(NO_SIGNALS, { type: "watching", at: 100 });
    expect(applyMessage(live, { type: "watching", at: 200, off: true }).watchingAt).toBeNull();
  });
});

describe("decideConfirm", () => {
  // The dialog opened at 10 s, confirm pressed at 10.5 s, the tutor's heartbeat fresh.
  const base: ConfirmInput = {
    now: 11_000,
    openedAt: 10_000,
    confirmedAt: 10_500,
    last: null,
    watchingAt: 9_000,
    checkedSeen: null,
  };

  it("saves at once with no live tutor", () => {
    expect(decideConfirm({ ...base, watchingAt: null })).toBe("save");
    expect(decideConfirm({ ...base, watchingAt: base.now - HOLD_TTL_MS })).toBe("save");
  });

  it("saves at once once the lesson has ended", () => {
    const ended = applyMessage(
      { ...NO_SIGNALS, watchingAt: base.watchingAt },
      { type: "watching", at: 10_900, off: true },
    );
    expect(decideConfirm({ ...base, ...ended })).toBe("save");
  });

  it("waits for the tutor to check a frame of the dialog", () => {
    expect(decideConfirm(base)).toBe("wait");
    expect(decideConfirm({ ...base, checkedSeen: base.openedAt })).toBe("wait");
  });

  it("still waits when a frame captured before the dialog is checked after it opened", () => {
    // Captured at 9.5 s, its check came back at 10.8 s: it can't have seen the dialog.
    const s = applyMessage(
      { ...NO_SIGNALS, watchingAt: base.watchingAt },
      { type: "checked", seen: 9_500, at: 10_800 },
    );
    expect(decideConfirm({ ...base, ...s })).toBe("wait");
  });

  it("still waits for a frame stamped within the shield's lag of the dialog opening", () => {
    // The pill's copy of the screen trails the real one: this frame may predate the dialog.
    expect(decideConfirm({ ...base, checkedSeen: base.openedAt + 1 })).toBe("wait");
    expect(decideConfirm({ ...base, checkedSeen: base.openedAt + FRAME_LAG_MS })).toBe("wait");
  });

  it("locks when the tutor steps in", () => {
    expect(decideConfirm({ ...base, last: hold([flag], 10_800) })).toBe("held");
    expect(decideConfirm({ ...base, last: hold([flag], 10_800), checkedSeen: 10_600 })).toBe(
      "held",
    );
    expect(decideConfirm({ ...base, last: hold([], 10_800) })).toBe("wait");
  });

  it("saves once a frame captured after the dialog opened comes back clean", () => {
    expect(decideConfirm({ ...base, checkedSeen: base.openedAt + FRAME_LAG_MS + 1 })).toBe("save");
  });

  it("saves anyway after the wait", () => {
    expect(decideConfirm({ ...base, now: base.confirmedAt + CONFIRM_WAIT_MS - 1 })).toBe("wait");
    expect(decideConfirm({ ...base, now: base.confirmedAt + CONFIRM_WAIT_MS })).toBe("save");
  });
});

describe("publish and subscribeHold", () => {
  it("no-op without BroadcastChannel", () => {
    expect(() => publishHold([flag], null)).not.toThrow();
    expect(() => publishWatching(false, null)).not.toThrow();
    expect(() => publishChecked(1, null)).not.toThrow();
    const off = subscribeHold(() => undefined, null);
    expect(() => off()).not.toThrow();
  });

  it("deliver messages to another channel, until unsubscribed", async () => {
    const got: TutorMessage[] = [];
    const off = subscribeHold((h) => got.push(h), Ctor);
    publishHold([flag], Ctor);
    await tick();
    expect(got).toHaveLength(1);
    const first = got[0] as HoldMessage;
    expect(first.flags).toEqual([flag]);
    expect(isHeld(first, Date.now())).toBe(true);

    publishHold([], Ctor);
    await tick();
    expect(got).toHaveLength(2);
    expect(isHeld(got[1] as HoldMessage, Date.now())).toBe(false);

    publishWatching(false, Ctor);
    publishChecked(1234, Ctor);
    publishWatching(true, Ctor);
    await tick();
    expect(got.slice(2).map((m) => m.type)).toEqual(["watching", "checked", "watching"]);
    expect(got[2]).not.toHaveProperty("off");
    expect(got[3]).toMatchObject({ type: "checked", seen: 1234 });
    expect(got[4]).toMatchObject({ type: "watching", off: true });

    const raw = new NodeChannel("tacit-tutor");
    raw.postMessage({ type: "hold", flags: "s2", at: 1 });
    raw.close();
    await tick();
    expect(got).toHaveLength(5);

    off();
    publishHold([flag], Ctor);
    await tick();
    expect(got).toHaveLength(5);
  });
});
