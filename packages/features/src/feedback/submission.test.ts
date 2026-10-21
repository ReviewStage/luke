import assert from "node:assert/strict";
import { test } from "vitest";
import { FEEDBACK_KIND, feedbackSubmission } from "./submission.js";

/**
 * A note as the main process reads it from the window: one sent from an
 * experiment's row names that experiment by its key, and nothing shaped
 * like prose passes as one.
 */

const NOTE = { kind: FEEDBACK_KIND.FEEDBACK, message: "The board missed a plan.", images: [] };

test("a note about an experiment keeps its key, and a note about none carries none", () => {
  assert.deepEqual(feedbackSubmission({ ...NOTE, experiment: "chat" }), {
    ...NOTE,
    experiment: "chat",
  });
  assert.deepEqual(feedbackSubmission(NOTE), NOTE);
});

test("nothing but a key's shape passes as the experiment a note is about", () => {
  for (const experiment of ["The Chat tab", "Chat", "chat\\nBcc: x", "", 7]) {
    assert.equal(feedbackSubmission({ ...NOTE, experiment }), undefined, String(experiment));
  }
});
