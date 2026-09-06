import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, realtimeToolDefinitions } from "@sidecar/acts";
import { BRAIN_TURN_AUTHORITY } from "@sidecar/hosted";
import {
  BRAIN_TOOL,
  brainToolAllowed,
  brainToolDefinitions,
  isBrainOnlyTool,
} from "./brain-tools.js";

test("a developer turn gets every act but the spoken transcript reading, plus the two reads, never announce", () => {
  const names = brainToolDefinitions(BRAIN_TURN_AUTHORITY.DEVELOPER).map((tool) => tool.name);
  for (const act of realtimeToolDefinitions()) {
    if (act.name === REALTIME_TOOL.READ_SESSION_TRANSCRIPT) {
      assert.ok(!names.includes(act.name));
    } else {
      assert.ok(names.includes(act.name), `${act.name} is offered`);
    }
  }
  assert.ok(names.includes(BRAIN_TOOL.LIST_SESSIONS));
  assert.ok(names.includes(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(!names.includes(BRAIN_TOOL.ANNOUNCE));
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, realtimeToolDefinitions().length - 1 + 2);
});

test("an observation turn gets the two reads and announce, and no act at all", () => {
  const names = brainToolDefinitions(BRAIN_TURN_AUTHORITY.OBSERVATION).map((tool) => tool.name);
  assert.deepEqual(
    [...names].sort(),
    [BRAIN_TOOL.LIST_SESSIONS, BRAIN_TOOL.READ_TRANSCRIPT, BRAIN_TOOL.ANNOUNCE].sort(),
  );
  for (const act of realtimeToolDefinitions()) {
    assert.ok(!brainToolAllowed(BRAIN_TURN_AUTHORITY.OBSERVATION, act.name), act.name);
  }
  assert.ok(brainToolAllowed(BRAIN_TURN_AUTHORITY.OBSERVATION, BRAIN_TOOL.ANNOUNCE));
  assert.ok(!brainToolAllowed(BRAIN_TURN_AUTHORITY.DEVELOPER, BRAIN_TOOL.ANNOUNCE));
  assert.ok(brainToolAllowed(BRAIN_TURN_AUTHORITY.DEVELOPER, REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(!brainToolAllowed(BRAIN_TURN_AUTHORITY.DEVELOPER, "delete_everything"));
});

test("announce takes the briefing alone and every definition is a function tool", () => {
  const announce = brainToolDefinitions(BRAIN_TURN_AUTHORITY.OBSERVATION).find(
    (tool) => tool.name === BRAIN_TOOL.ANNOUNCE,
  );
  assert.ok(announce);
  assert.deepEqual(announce.parameters.required, ["briefing"]);
  assert.deepEqual(Object.keys(announce.parameters.properties), ["briefing"]);
  for (const authority of Object.values(BRAIN_TURN_AUTHORITY)) {
    for (const tool of brainToolDefinitions(authority)) assert.equal(tool.type, "function");
  }
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(!isBrainOnlyTool(REALTIME_TOOL.SEND_SESSION_MESSAGE));
});
