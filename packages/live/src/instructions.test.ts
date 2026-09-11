import assert from "node:assert/strict";
import { test } from "vitest";
import { APPEND_TOKEN_BOUND, chunkForAppend } from "./chunks.js";
import {
  greetingInstruction,
  INSTRUCTION_SECTION,
  type InstructionSection,
  LIVE_SCENE,
  sessionInstructionBlocks,
  sessionInstructions,
} from "./instructions.js";
import { estimatedTokens } from "./tokens.js";

/** The API's bound on `instructions`, in tokens. */
const INSTRUCTIONS_TOKEN_BOUND = 16_384;

/** The guide's template carries three identity sentences, one per line, and a scene fills the bracket in the first. */
const IDENTITY_LINES = 3;

const SECTION_ORDER = [
  INSTRUCTION_SECTION.IDENTITY,
  INSTRUCTION_SECTION.BACKCHANNEL_POLICY,
  INSTRUCTION_SECTION.INTERRUPTION_POLICY,
  INSTRUCTION_SECTION.DELEGATION_POLICY,
];

for (const scene of Object.values(LIVE_SCENE)) {
  test(`the ${scene} scene emits the guide's four sections in its order`, () => {
    const blocks = sessionInstructionBlocks(scene);

    assert.deepEqual(
      blocks.map((block) => block.section),
      SECTION_ORDER,
    );
    for (const block of blocks) assert.ok(block.lines.length > 0);
  });

  test(`the ${scene} scene's identity block is the template's three sentences and no more`, () => {
    const identity = sessionInstructionBlocks(scene).find(
      (block) => block.section === INSTRUCTION_SECTION.IDENTITY,
    );

    assert.equal(identity?.lines.length, IDENTITY_LINES);
  });

  test(`the ${scene} scene's instructions are the blocks joined, well under the API's bound`, () => {
    const blocks = sessionInstructionBlocks(scene);
    const instructions = sessionInstructions(scene);

    assert.equal(instructions, blocks.map((block) => block.lines.join("\n")).join("\n\n"));
    assert.ok(estimatedTokens(instructions) < INSTRUCTIONS_TOKEN_BOUND / 8);
  });
}

test("the two scenes share their backchannel and interruption policies and differ elsewhere", () => {
  const desktop = sessionInstructionBlocks(LIVE_SCENE.DESKTOP);
  const introduction = sessionInstructionBlocks(LIVE_SCENE.INTRODUCTION);
  const shared: readonly InstructionSection[] = [
    INSTRUCTION_SECTION.BACKCHANNEL_POLICY,
    INSTRUCTION_SECTION.INTERRUPTION_POLICY,
  ];

  for (const [index, section] of SECTION_ORDER.entries()) {
    const same = desktop[index]?.lines === introduction[index]?.lines;
    assert.equal(same, shared.includes(section), section);
  }
});

test("the greeting is one append's worth of instruction", () => {
  const greeting = greetingInstruction();

  assert.ok(estimatedTokens(greeting) <= APPEND_TOKEN_BOUND);
  assert.equal(chunkForAppend(greeting).length, 1);
  assert.equal(greeting.includes("\n"), false);
});
