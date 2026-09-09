import assert from "node:assert/strict";
import test from "node:test";
import {
  ABC,
  answered,
  claude,
  DEF,
  edge,
  harness,
  itemText,
  message,
  NOW,
  quietAnswer,
  settle,
} from "./harness.js";
import { BRAIN_INPUT_MARKER } from "./input-items.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

/**
 * The coalescing window against a quiet model: wakes and a review postponed
 * by a throttle open once the quiet ends rather than being dropped.
 */

test("a quiet client keeps the wakes pending and retries once the quiet ends", async () => {
  const h = harness();
  h.client.answers.push(quietAnswer(NOW + 60_000));
  await h.agent.wake([edge(ABC), edge(DEF)]);
  await h.clock.advance(NOW + 3_000);
  assert.equal(h.client.inputs.length, 1);
  assert.equal(h.agent.pendingWakes(), 2);
  // The throttled turn consumed nothing: both captured entries stand on disk
  // with their capture cursors, and no consumed cursor moved.
  assert.equal(h.persisted.length, 1);
  assert.equal(h.repository.state?.inbox.length, 2);
  assert.deepEqual(h.repository.state?.captureCursors, {
    [claude.id]: { abc: "abc-cursor", def: "def-cursor" },
  });
  assert.deepEqual(h.repository.state?.cursors, {});

  h.client.quiet = NOW + 60_000;
  await h.clock.advance(NOW + 30_000);
  assert.equal(h.client.inputs.length, 1);
  h.client.quiet = undefined;
  await h.clock.advance(NOW + 70_000);
  assert.equal(h.client.inputs.length, 2);
  assert.equal(h.agent.pendingWakes(), 0);
  assert.equal(h.persisted.length, 2);
  // The retry read no transcript twice: the entries were consumed as captured.
  assert.equal(h.sinceReads.length, 2);
  assert.equal(h.repository.state?.inbox.length, 0);
  assert.deepEqual(h.repository.state?.cursors, h.repository.state?.captureCursors);
});

test("a heartbeat asked of a quiet model is not lost: the review opens once the quiet ends", async () => {
  const h = harness();
  h.client.quiet = NOW + 60_000;
  // The occurrence the scheduler recorded settles at once, with the retry
  // armed: the tick is not held open for as long as the quiet lasts.
  await h.agent.heartbeat();
  await settle();
  assert.equal(h.client.inputs.length, 0);
  assert.equal(h.clock.timers.size, 1);
  // Asked again while still quiet: one retry stands, not two.
  await h.agent.heartbeat();
  await settle();
  assert.equal(h.clock.timers.size, 1);
  h.client.answers.push(answered([message("")]));
  await h.clock.advance(NOW + 30_000);
  assert.equal(h.client.inputs.length, 0);
  h.client.quiet = undefined;
  await h.clock.advance(NOW + 60_000);
  await settle();
  assert.equal(h.client.inputs.length, 1);
  assert.ok(itemText((h.client.inputs[0] ?? [])[0]).startsWith(BRAIN_INPUT_MARKER.HEARTBEAT));
  assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.HEARTBEAT);

  // A throttle answered mid-run retries the same way.
  const throttled = harness();
  throttled.client.answers.push(quietAnswer(NOW + 10_000), answered([message("")]));
  // A throttle answered mid-run is still this occurrence's turn: the promise
  // settles with it, quiet and all, and the retry stands behind it.
  await throttled.agent.heartbeat();
  assert.equal(throttled.client.inputs.length, 1);
  await throttled.clock.advance(NOW + 10_000);
  await settle();
  assert.equal(throttled.client.inputs.length, 2);
});
