import assert from "node:assert/strict";
import { test } from "vitest";
import { APPEND_TOKEN_BOUND, chunkForAppend } from "./chunks.js";
import {
  greetingCue,
  greetingInstruction,
  LIVE_SCENE,
  sessionInstructions,
} from "./instructions.js";
import { estimatedTokens } from "./tokens.js";

/** The API's bound on `instructions`, in tokens. */
const INSTRUCTIONS_TOKEN_BOUND = 16_384;

const blocksOf = (scene: (typeof LIVE_SCENE)[keyof typeof LIVE_SCENE]): string[] =>
  sessionInstructions(scene).split("\n\n");

for (const scene of Object.values(LIVE_SCENE)) {
  test(`the ${scene} scene's instructions sit well under the API's bound`, () => {
    assert.ok(estimatedTokens(sessionInstructions(scene)) < INSTRUCTIONS_TOKEN_BOUND / 8);
  });
}

test("every scene is told the same thing, delegation policy included", () => {
  assert.deepEqual(blocksOf(LIVE_SCENE.INTRODUCTION), blocksOf(LIVE_SCENE.DESKTOP));
});

test("the greeting is one append's worth of instruction", () => {
  const greeting = greetingInstruction();

  assert.ok(estimatedTokens(greeting) <= APPEND_TOKEN_BOUND);
  assert.equal(chunkForAppend(greeting).length, 1);
  assert.equal(greeting.includes("\n"), false);
});

test("the cue that follows it is one append's worth of commentary", () => {
  const cue = greetingCue();

  assert.ok(estimatedTokens(cue) <= APPEND_TOKEN_BOUND);
  assert.equal(chunkForAppend(cue).length, 1);
  assert.equal(cue.includes("\n"), false);
});
