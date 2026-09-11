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

/** The guide's template carries three identity sentences, one per line, ahead of the first blank line. */
const IDENTITY_LINES = 3;

const blocksOf = (scene: (typeof LIVE_SCENE)[keyof typeof LIVE_SCENE]): string[] =>
  sessionInstructions(scene).split("\n\n");

for (const scene of Object.values(LIVE_SCENE)) {
  test(`the ${scene} scene opens on the template's three identity lines and no more`, () => {
    assert.equal(blocksOf(scene)[0]?.split("\n").length, IDENTITY_LINES);
  });

  test(`the ${scene} scene's instructions sit well under the API's bound`, () => {
    assert.ok(estimatedTokens(sessionInstructions(scene)) < INSTRUCTIONS_TOKEN_BOUND / 8);
  });
}

/** Identity, backchannel, and interruption: every block the two scenes share, ahead of the delegation policy. */
const SHARED_BLOCKS = 3;

test("the two scenes differ in their delegation policy alone", () => {
  const desktop = blocksOf(LIVE_SCENE.DESKTOP);
  const introduction = blocksOf(LIVE_SCENE.INTRODUCTION);

  assert.deepEqual(desktop.slice(0, SHARED_BLOCKS), introduction.slice(0, SHARED_BLOCKS));
  assert.notEqual(
    desktop.slice(SHARED_BLOCKS).join("\n\n"),
    introduction.slice(SHARED_BLOCKS).join("\n\n"),
  );
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
