import assert from "node:assert/strict";
import { Duration } from "effect";
import { test } from "vitest";
import {
  PENDING_LIMIT,
  type PendingValues,
  pendingSettled,
  pendingShown,
  pendingValue,
  pendingWithout,
} from "./pending-values.js";

const TASK = "task-1";

const same = (a: string, b: string) => a === b;

/** The pending values of one task, as a press over `viewed` asked `value`. */
function asked(value: string, viewed: string): PendingValues<string, string> {
  return new Map([[TASK, pendingValue(undefined, value, viewed, same)]]);
}

/** What stands drawn for the task once the view carries `viewed` at `now`. */
function drawnAfter(
  held: PendingValues<string, string>,
  viewed: string | undefined,
  now?: number,
): string | undefined {
  return pendingShown(pendingSettled(held, () => viewed, same, now)).get(TASK);
}

test("a value stands over the view until the view carries it", () => {
  const held = asked("Launch plan", "Draft");

  assert.equal(drawnAfter(held, "Draft"), "Launch plan");
  assert.equal(drawnAfter(held, "Launch plan"), undefined);
});

test("a view that moves to a third value wins, as when the service trims the name or a teammate renamed it first", () => {
  const held = asked(" Launch plan ", "Draft");

  assert.equal(drawnAfter(held, "Launch plan"), undefined);
  assert.equal(drawnAfter(held, "Ship it"), undefined);
});

test("a view gone from what the value names lets it go", () => {
  assert.equal(drawnAfter(asked("Launch plan", "Draft"), undefined), undefined);
});

test("a second press stands while the view passes through the first press's value on its way", () => {
  const first = pendingValue(undefined, "Launch", "Draft", same);
  const second = pendingValue(first, "Launch plan", "Draft", same);
  const held = new Map([[TASK, second]]);

  assert.equal(drawnAfter(held, "Launch"), "Launch plan");
  assert.equal(drawnAfter(held, "Launch plan"), undefined);
});

test("a value the view never answers gives way once its time runs out, counted from the clock's first reading after the press", () => {
  const limit = Duration.toMillis(PENDING_LIMIT);
  const read = pendingSettled(asked("Launch plan", "Draft"), () => "Draft", same, 1_000);

  assert.equal(drawnAfter(read, "Draft", 1_000 + limit - 1), "Launch plan");
  assert.equal(drawnAfter(read, "Draft", 1_000 + limit), undefined);
});

test("a refusal lets go of its own value and never of a later press's", () => {
  const first = pendingValue(undefined, "Launch", "Draft", same);
  const second = pendingValue(first, "Launch plan", "Draft", same);
  const held = new Map([[TASK, second]]);

  assert.equal(pendingShown(pendingWithout(held, TASK, first)).get(TASK), "Launch plan");
  assert.equal(pendingShown(pendingWithout(held, TASK, second)).get(TASK), undefined);
});

test("a refusal answered after the clock read still lets go of its press", () => {
  const pending = pendingValue(undefined, "Launch plan", "Draft", same);
  const read = pendingSettled(new Map([[TASK, pending]]), () => "Draft", same, 1_000);

  assert.equal(pendingShown(pendingWithout(read, TASK, pending)).get(TASK), undefined);
});
