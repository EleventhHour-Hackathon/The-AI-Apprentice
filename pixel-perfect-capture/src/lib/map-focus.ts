/**
 * Moving through a Work Map one item at a time: what Next and Previous land on.
 *
 * Next follows the workflow: from a step, the next step; from a guardrail, the next guardrail on
 * the same step, then its step's next step. Guardrails not tied to a step come after the last
 * step, in order. Previous walks back: a guardrail goes to the one before it on its step, then to
 * the step itself; a step goes to the step before it.
 */

export type FocusKind = "step" | "guardrail";
/** An item on the map, by its index in `steps` or `guardrails`. */
export type FocusItem = { kind: FocusKind; index: number };

type MapShape = {
  steps: readonly { id: string }[];
  guardrails: readonly { id: string; step: string }[];
};

/** Each step's guardrails, and those tied to no step, in map order. */
function groups(map: MapShape) {
  // Like the layout: a step id that appears twice means the later step.
  const stepIndex = new Map(map.steps.map((s, i) => [s.id, i]));
  const byStep = map.steps.map((): number[] => []);
  const loose: number[] = [];
  const owner: (number | null)[] = [];
  map.guardrails.forEach((g, gi) => {
    const si = g.step ? stepIndex.get(g.step) : undefined;
    owner.push(si ?? null);
    if (si === undefined) loose.push(gi);
    else byStep[si]!.push(gi);
  });
  return { byStep, loose, owner };
}

const valid = (map: MapShape, item: FocusItem | null): item is FocusItem =>
  item !== null &&
  Number.isInteger(item.index) &&
  item.index >= 0 &&
  item.index < (item.kind === "step" ? map.steps.length : map.guardrails.length);

const step = (index: number): FocusItem => ({ kind: "step", index });
const guardrail = (index: number): FocusItem => ({ kind: "guardrail", index });

/** Where Next goes from `current` (nothing selected: the first item), or null at the end. */
export function nextItem(map: MapShape, current: FocusItem | null): FocusItem | null {
  const { byStep, loose, owner } = groups(map);
  const afterStep = (si: number): FocusItem | null =>
    si + 1 < map.steps.length ? step(si + 1) : loose.length ? guardrail(loose[0]!) : null;
  if (!valid(map, current)) return map.steps.length ? step(0) : afterStep(-1);
  if (current.kind === "step") return afterStep(current.index);
  const si = owner[current.index];
  const siblings = si === null || si === undefined ? loose : byStep[si]!;
  const at = siblings.indexOf(current.index);
  if (at + 1 < siblings.length) return guardrail(siblings[at + 1]!);
  return si === null || si === undefined ? null : afterStep(si);
}

/** Where Previous goes from `current`, or null at the start. */
export function prevItem(map: MapShape, current: FocusItem | null): FocusItem | null {
  if (!valid(map, current)) return null;
  const { byStep, loose, owner } = groups(map);
  if (current.kind === "step") return current.index > 0 ? step(current.index - 1) : null;
  const si = owner[current.index];
  const siblings = si === null || si === undefined ? loose : byStep[si]!;
  const at = siblings.indexOf(current.index);
  if (at > 0) return guardrail(siblings[at - 1]!);
  if (si !== null && si !== undefined) return step(si);
  return map.steps.length ? step(map.steps.length - 1) : null;
}

/** The step or guardrail with this id ("s1", "g2"...), steps first. */
export function findItem(map: MapShape, id: string): FocusItem | null {
  const si = map.steps.findIndex((s) => s.id === id);
  if (si >= 0) return step(si);
  const gi = map.guardrails.findIndex((g) => g.id === id);
  return gi >= 0 ? guardrail(gi) : null;
}

/** The id of an item, for callers that name items rather than index them. */
export function itemId(map: MapShape, item: FocusItem): string | null {
  const list = item.kind === "step" ? map.steps : map.guardrails;
  return list[item.index]?.id ?? null;
}
