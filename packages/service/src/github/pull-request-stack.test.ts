import assert from "node:assert/strict";
import { OVERVIEW_BOUNDS } from "@luke/features/coding-agent-wire";
import { describe, test } from "vitest";
import { type StackCandidate, stackOf } from "./pull-request-stack.js";

/**
 * The stack a pull request stands in, worked out from the repository's open
 * pull requests as stage-cli works it out: base first, a branch many target
 * stacking none of them, a fork's head standing on nothing, and a loop no
 * stack at all. Synthetic branches throughout.
 */

/** An open pull request of the repository from `head` into `base`. */
function open(number: number, head: string, base: string, crossRepository = false): StackCandidate {
  return {
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    draft: false,
    head,
    base,
    crossRepository,
  };
}

const numbers = (stack: readonly { readonly number: number }[]) => stack.map((each) => each.number);

describe("stackOf", () => {
  test("walks the whole chain both ways, base first, from a pull request in its middle", () => {
    const current = open(2, "b", "a");
    const listed = [open(4, "d", "c"), open(1, "a", "main"), current, open(3, "c", "b")];
    assert.deepEqual(numbers(stackOf(current, listed)), [1, 2, 3, 4]);
  });

  test("a pull request nothing stands on or under stands in no stack", () => {
    const current = open(2, "b", "main");
    assert.deepEqual(stackOf(current, [current, open(3, "c", "main")]), []);
  });

  test("a branch two open pull requests target stacks neither on it", () => {
    const current = open(2, "b", "a");
    const listed = [open(1, "a", "main"), current, open(3, "c", "b"), open(4, "d", "b")];
    assert.deepEqual(numbers(stackOf(current, listed)), [1, 2]);
  });

  test("a head two open pull requests share is stood on by neither", () => {
    const current = open(3, "c", "b");
    const listed = [open(1, "b", "main"), open(2, "b", "release"), current];
    assert.deepEqual(stackOf(current, listed), []);
  });

  test("a fork's branch named like the base stands under nothing", () => {
    const current = open(2, "b", "a");
    assert.deepEqual(stackOf(current, [open(1, "a", "main", true), current]), []);
  });

  test("a chain that loops back on itself is no stack", () => {
    const current = open(1, "a", "b");
    assert.deepEqual(stackOf(current, [current, open(2, "b", "a")]), []);
  });

  test("the pull request itself counts when the bounded listing left it out", () => {
    const current = open(2, "b", "a");
    assert.deepEqual(numbers(stackOf(current, [open(1, "a", "main")])), [1, 2]);
  });

  test("a chain longer than the bound is cut there", () => {
    const chain = Array.from({ length: OVERVIEW_BOUNDS.MAX_STACK + 5 }, (_, at) =>
      open(at + 1, `b${at + 1}`, at === 0 ? "main" : `b${at}`),
    );
    const current = chain[0];
    assert.ok(current !== undefined);
    assert.equal(stackOf(current, chain).length, OVERVIEW_BOUNDS.MAX_STACK);
  });
});
