import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_WORK_LANGUAGE_INSTRUCTION, LUKE_PERSONA } from "./persona.js";

test("the persona names the evidence a surface actually hands Luke, never a retired prompt field", () => {
  // The attention prompt's `subject` and `Work:` lines no longer reach any
  // live surface: the brain reads roster JSON and transcript deltas, the
  // voice is handed the brain's words, and the phone reads roster lines.
  assert.doesNotMatch(AGENT_WORK_LANGUAGE_INSTRUCTION, /Work field/);
  assert.doesNotMatch(AGENT_WORK_LANGUAGE_INSTRUCTION, /subject an update/);
  assert.match(AGENT_WORK_LANGUAGE_INSTRUCTION, /transcript/);
  assert.match(AGENT_WORK_LANGUAGE_INSTRUCTION, /title/);
  assert.match(AGENT_WORK_LANGUAGE_INSTRUCTION, /"your agent working on \[work\]"/);
});

test("the honesty clause bounds Luke to what he was shown without denying the brain its memory", () => {
  // The brain keeps a memory across turns, so the persona shared with it
  // cannot say Luke was handed no past; the rule against inventing one stays.
  assert.doesNotMatch(LUKE_PERSONA, /not handed the hours/);
  assert.match(LUKE_PERSONA, /where you have that memory/);
  assert.match(LUKE_PERSONA, /claim to have watched what you\s+were not shown/);
  assert.match(LUKE_PERSONA, /no since-ten, no all-afternoon/);
});
