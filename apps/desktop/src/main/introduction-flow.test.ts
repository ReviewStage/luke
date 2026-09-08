import assert from "node:assert/strict";
import test from "node:test";
import {
  introductionCompleted,
  introductionRecord,
  shouldRunIntroduction,
} from "./introduction-flow";

test("the introduction plays on a first interactive launch with no account", () => {
  assert.equal(
    shouldRunIntroduction({ requiresAccount: true, signedIn: false, completed: false }),
    true,
  );
});

test("a signed-in launch has already met Luke", () => {
  assert.equal(
    shouldRunIntroduction({ requiresAccount: true, signedIn: true, completed: false }),
    false,
  );
});

test("a deterministic run never gives the introduction", () => {
  assert.equal(
    shouldRunIntroduction({ requiresAccount: false, signedIn: false, completed: false }),
    false,
  );
});

test("a completed introduction never replays", () => {
  assert.equal(
    shouldRunIntroduction({ requiresAccount: true, signedIn: false, completed: true }),
    false,
  );
});

test("the record round-trips, and anything else reads as never finished", () => {
  assert.equal(introductionCompleted(introductionRecord("2026-08-24T00:00:00.000Z")), true);
  assert.equal(introductionCompleted(undefined), false);
  assert.equal(introductionCompleted(""), false);
  assert.equal(introductionCompleted("not json"), false);
  assert.equal(introductionCompleted("{}"), false);
  assert.equal(introductionCompleted('{"completedAt":7}'), false);
});
