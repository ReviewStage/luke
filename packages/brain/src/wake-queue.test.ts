import assert from "node:assert/strict";
import { test } from "vitest";
import { ABC, claude, DEF, edge, harness, NOW, quietAnswer } from "./harness.js";

/**
 * The coalescing window against a quiet model: wakes postponed by a throttle
 * open once the quiet ends rather than being dropped.
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
