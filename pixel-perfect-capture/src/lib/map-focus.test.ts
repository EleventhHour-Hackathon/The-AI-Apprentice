import { describe, expect, it } from "vitest";
import { findItem, itemId, nextItem, prevItem, type FocusItem } from "./map-focus";

const s = (index: number): FocusItem => ({ kind: "step", index });
const g = (index: number): FocusItem => ({ kind: "guardrail", index });

// s1 has two guardrails (g1, g3), s2 none, s3 one (g2); g4 is tied to no step, g5 to a missing one.
const map = {
  steps: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
  guardrails: [
    { id: "g1", step: "s1" },
    { id: "g2", step: "s3" },
    { id: "g3", step: "s1" },
    { id: "g4", step: "" },
    { id: "g5", step: "s9" },
  ],
};

describe("nextItem", () => {
  it("starts at the first step", () => {
    expect(nextItem(map, null)).toEqual(s(0));
  });

  it("goes from a step to the next step, skipping its guardrails", () => {
    expect(nextItem(map, s(0))).toEqual(s(1));
    expect(nextItem(map, s(1))).toEqual(s(2));
  });

  it("goes from a guardrail to the next one on its step, then to the next step", () => {
    expect(nextItem(map, g(0))).toEqual(g(2));
    expect(nextItem(map, g(2))).toEqual(s(1));
    expect(nextItem(map, g(1))).toEqual(g(3));
  });

  it("goes on to the guardrails tied to no step after the last step, then ends", () => {
    expect(nextItem(map, s(2))).toEqual(g(3));
    expect(nextItem(map, g(3))).toEqual(g(4));
    expect(nextItem(map, g(4))).toBeNull();
  });

  it("ends at the last step when every guardrail has a step", () => {
    const tidy = { steps: map.steps, guardrails: [{ id: "g1", step: "s1" }] };
    expect(nextItem(tidy, s(2))).toBeNull();
  });

  it("handles an empty map and a map with only loose guardrails", () => {
    const empty = { steps: [], guardrails: [] };
    expect(nextItem(empty, null)).toBeNull();
    expect(prevItem(empty, null)).toBeNull();
    const loose = {
      steps: [],
      guardrails: [
        { id: "g1", step: "" },
        { id: "g2", step: "x" },
      ],
    };
    expect(nextItem(loose, null)).toEqual(g(0));
    expect(nextItem(loose, g(0))).toEqual(g(1));
    expect(nextItem(loose, g(1))).toBeNull();
    expect(prevItem(loose, g(1))).toEqual(g(0));
    expect(prevItem(loose, g(0))).toBeNull();
  });

  it("treats an item that isn't on the map as nothing selected", () => {
    expect(nextItem(map, s(7))).toEqual(s(0));
    expect(prevItem(map, g(9))).toBeNull();
  });
});

describe("prevItem", () => {
  it("goes from a step to the step before it, and stops at the first", () => {
    expect(prevItem(map, s(2))).toEqual(s(1));
    expect(prevItem(map, s(0))).toBeNull();
  });

  it("goes from a guardrail to the one before it on its step, then to the step", () => {
    expect(prevItem(map, g(2))).toEqual(g(0));
    expect(prevItem(map, g(0))).toEqual(s(0));
    expect(prevItem(map, g(1))).toEqual(s(2));
  });

  it("goes from the first loose guardrail back to the last step", () => {
    expect(prevItem(map, g(3))).toEqual(s(2));
    expect(prevItem(map, g(4))).toEqual(g(3));
  });
});

describe("ids", () => {
  it("finds steps and guardrails by id", () => {
    expect(findItem(map, "s2")).toEqual(s(1));
    expect(findItem(map, "g3")).toEqual(g(2));
    expect(findItem(map, "nope")).toBeNull();
  });

  it("names an item by its id", () => {
    expect(itemId(map, s(2))).toBe("s3");
    expect(itemId(map, g(4))).toBe("g5");
    expect(itemId(map, s(5))).toBeNull();
  });
});
