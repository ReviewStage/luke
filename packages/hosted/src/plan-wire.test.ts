import assert from "node:assert/strict";
import { test } from "vitest";
import { ROLLOUT_BASE, type Rollout, type RolloutItem, rolloutStacksOf } from "./plan-wire.js";

/** A rollout whose pull requests base, in order, on the bases named; the words are what no chain reads. */
function rolloutOn(bases: readonly RolloutItem["base"][]): Rollout {
  return bases.map((base, at) => ({
    title: `Pull request ${at + 1}`,
    scope: "The change.",
    base,
    acceptance: null,
  }));
}

const MAIN = ROLLOUT_BASE.MAIN;

test("a chain is one stack on main, its pull requests from the bottom up", () => {
  assert.deepEqual(rolloutStacksOf(rolloutOn([MAIN, 1, 2])), [
    { bottom: 1, positions: [1, 2, 3], base: MAIN },
  ]);
});

test("of two pull requests on one, the lower goes on up its chain and the other starts a stack based on it", () => {
  assert.deepEqual(rolloutStacksOf(rolloutOn([MAIN, 1, 1])), [
    { bottom: 1, positions: [1, 2], base: MAIN },
    { bottom: 3, positions: [3], base: 1 },
  ]);
});

test("two pull requests on main are two stacks on main", () => {
  assert.deepEqual(rolloutStacksOf(rolloutOn([MAIN, MAIN, 2])), [
    { bottom: 1, positions: [1], base: MAIN },
    { bottom: 2, positions: [2, 3], base: MAIN },
  ]);
});

test("a tree is cut into a stack per branch, each based on the pull request it leaves, lowest bottom first", () => {
  // 1 on main; 2 and 4 on 1; 3 on 2; 5 and 9 on 4; 6 on 5, 7 on 6, 8 on 7;
  // 10 on 9; 11 and 13 on 10; 12 on 11; 14 on 13; 15 on 14.
  const rollout = rolloutOn([MAIN, 1, 2, 1, 4, 5, 6, 7, 4, 9, 10, 11, 10, 13, 14]);

  assert.deepEqual(rolloutStacksOf(rollout), [
    { bottom: 1, positions: [1, 2, 3], base: MAIN },
    { bottom: 4, positions: [4, 5, 6, 7, 8], base: 1 },
    { bottom: 9, positions: [9, 10, 11, 12], base: 4 },
    { bottom: 13, positions: [13, 14, 15], base: 10 },
  ]);
});

test("an empty rollout has no stacks", () => {
  assert.deepEqual(rolloutStacksOf([]), []);
});
