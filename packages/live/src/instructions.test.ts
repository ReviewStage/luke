import assert from "node:assert/strict";
import { test } from "vitest";
import { APPEND_TOKEN_BOUND, chunkForAppend } from "./chunks.js";
import { greetingCue, planningOpeningInstruction, sessionInstructions } from "./instructions.js";
import { estimatedTokens } from "./tokens.js";

/** The API's bound on `instructions`, in tokens. */
const INSTRUCTIONS_TOKEN_BOUND = 16_384;

test("the planning call's instructions sit well under the API's bound", () => {
  assert.ok(estimatedTokens(sessionInstructions()) < INSTRUCTIONS_TOKEN_BOUND / 8);
});

test("the cue that follows the opening is one append's worth of commentary", () => {
  const cue = greetingCue();

  assert.ok(estimatedTokens(cue) <= APPEND_TOKEN_BOUND);
  assert.equal(chunkForAppend(cue).length, 1);
  assert.equal(cue.includes("\n"), false);
});

test("a planning call's opening is one append's worth of instruction", () => {
  const opening = planningOpeningInstruction();

  assert.ok(estimatedTokens(opening) <= APPEND_TOKEN_BOUND);
  assert.equal(chunkForAppend(opening).length, 1);
  assert.equal(opening.includes("\n"), false);
});

test("a planning call delegates to the planning model's reads, and has no save to delegate", () => {
  const blocks = sessionInstructions().split("\n\n");
  const policy = blocks.find((block) => block.startsWith("Delegation policy:"));

  assert.ok(policy);
  // The notetaker writes the plan, so the voice never delegates to save it.
  assert.equal(policy.includes("update_plan"), false);
  assert.ok(policy.includes("run_in_repository"));
});
