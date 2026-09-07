import assert from "node:assert/strict";
import test from "node:test";
import { isSidewaysStep, panningBlockBetween, revealAfterStep } from "./history-time-reveal";

test("only a step more sideways than tall is a pull; the rest is the thread's scroll", () => {
  assert.equal(isSidewaysStep({ deltaX: 12, deltaY: 3 }), true);
  assert.equal(isSidewaysStep({ deltaX: -12, deltaY: 3 }), true);
  assert.equal(isSidewaysStep({ deltaX: 3, deltaY: 12 }), false);
  assert.equal(isSidewaysStep({ deltaX: 5, deltaY: -5 }), false);
  assert.equal(isSidewaysStep({ deltaX: 0, deltaY: 0 }), false);
});

test("fingers moving left uncover the stamps and moving right cover them", () => {
  assert.equal(revealAfterStep(0, 20, 56), 20);
  assert.equal(revealAfterStep(20, 16, 56), 36);
  assert.equal(revealAfterStep(36, -30, 56), 6);
});

test("the reveal stops at the column's edge and at rest, so a long pull unwinds in one push", () => {
  assert.equal(revealAfterStep(50, 40, 56), 56);
  assert.equal(revealAfterStep(56, 400, 56), 56);
  assert.equal(revealAfterStep(56, -60, 56), 0);
  assert.equal(revealAfterStep(0, -25, 56), 0);
});

test("a thread with no stamp drawn has nothing to reveal", () => {
  assert.equal(revealAfterStep(0, 40, 0), 0);
});

/**
 * Enough of an element tree for the walk, root first: the first mark is the
 * thread's, the last the leaf's, and each says whether that element pans.
 */
function chain(...pans: boolean[]): {
  leaf: Element;
  thread: Element;
  pans: (element: Element) => boolean;
} {
  const panning = new Set<Element>();
  const nodes: Element[] = [];
  for (const marks of pans) {
    const node = { parentElement: nodes.at(-1) ?? null } as unknown as Element;
    if (marks) panning.add(node);
    nodes.push(node);
  }
  return {
    leaf: nodes.at(-1) as Element,
    thread: nodes[0] as Element,
    pans: (element) => panning.has(element),
  };
}

test("a step over a block that pans sideways is the block's, wherever the block stands", () => {
  const over = chain(false, false, true, false);
  assert.equal(panningBlockBetween(over.leaf, over.thread, over.pans), true);
  const beside = chain(false, false, false, false);
  assert.equal(panningBlockBetween(beside.leaf, beside.thread, beside.pans), false);
});

test("the thread itself is never mistaken for a panning block", () => {
  const { leaf, thread, pans } = chain(true, false, false);
  assert.equal(panningBlockBetween(leaf, thread, pans), false);
  assert.equal(panningBlockBetween(null, thread, pans), false);
});
