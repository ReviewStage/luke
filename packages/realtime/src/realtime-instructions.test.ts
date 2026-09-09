import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_NO_LONGER_OBSERVED_NOTE } from "@sidecar/session";
import {
  ASK_BRAIN_TOOL,
  realtimeInstructions,
  remoteRealtimeInstructions,
} from "./realtime-instructions.js";

test("unclear audio is clarified without guessing or acting", () => {
  const instructions = realtimeInstructions();

  assert.match(instructions, /audio is noisy, ambiguous, or cut off/i);
  assert.match(instructions, /never infer[\s\S]*or call a tool from unclear audio/i);
});

test("the voice knows nothing of the work itself and asks the brain for all of it", () => {
  const instructions = realtimeInstructions();

  assert.match(instructions, new RegExp(`call ${ASK_BRAIN_TOOL.name}`));
  assert.match(
    instructions,
    /a brief acknowledgement of about five words[\s\S]*varying the wording/,
  );
  assert.match(instructions, /say its answer whole/);
  assert.match(instructions, /Never invent an agent, a status, or an outcome/);
  // The roster, the guide, and the history are the brain's, so the voice is
  // taught no rule for resolving an agent out of them.
  assert.doesNotMatch(instructions, /observed session status/);
  assert.doesNotMatch(instructions, /recent conversation/);
});

test("the remote call keeps the roster rules the phone still resolves agents by", () => {
  const instructions = remoteRealtimeInstructions();

  assert.match(instructions, /\[observed session status\]/);
  assert.match(instructions, /never read it out/);
  assert.match(instructions, new RegExp(SESSION_NO_LONGER_OBSERVED_NOTE));
  assert.match(instructions, /audio is noisy, ambiguous, or cut off/i);
  assert.doesNotMatch(instructions, new RegExp(ASK_BRAIN_TOOL.name));
});
