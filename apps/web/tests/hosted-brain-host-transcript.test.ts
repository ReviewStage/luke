// hosted-brain-host-transcript.test.ts -- the delta bound cuts whole lines from the front, measured as the turn joins them.
import assert from "node:assert/strict";
import { test } from "vitest";
import { BRAIN_HOST } from "../server/hosted/brain-host/bounds.js";
import { boundedLines } from "../server/hosted/brain-host/transcript.js";

const BOUND = BRAIN_HOST.TRANSCRIPT_DELTA_CHARS;

test("a delta whose joined text fits the bound exactly is kept whole, and one character more drops its oldest line", () => {
  const half = "a".repeat((BOUND - 1) / 2);
  const exact = [half, `${half}b`];
  assert.equal(exact.join("\n").length, BOUND);
  assert.deepEqual(boundedLines(exact), { lines: exact, dropped: false });

  const over = [half, `${half}bc`];
  assert.deepEqual(boundedLines(over), { lines: [over[1]], dropped: true });
});

test("a single line past the bound is kept whole rather than dropped, and no lines are no lines", () => {
  const long = "x".repeat(BOUND + 5);
  assert.deepEqual(boundedLines([long]), { lines: [long], dropped: false });
  assert.deepEqual(boundedLines([]), { lines: [], dropped: false });
});
