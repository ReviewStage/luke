import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, realtimeToolDefinitions } from "@sidecar/acts";
import { BRAIN_TOOL, brainToolDefinitions, isBrainOnlyTool } from "./brain-tools.js";

test("the brain gets every act but the spoken transcript reading, plus its own three", () => {
  const names = brainToolDefinitions().map((tool) => tool.name);
  for (const act of realtimeToolDefinitions()) {
    if (act.name === REALTIME_TOOL.READ_SESSION_TRANSCRIPT) {
      assert.ok(!names.includes(act.name));
    } else {
      assert.ok(names.includes(act.name), `${act.name} is offered`);
    }
  }
  for (const own of Object.values(BRAIN_TOOL)) assert.ok(names.includes(own));
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, realtimeToolDefinitions().length - 1 + 3);
});

test("announce names sessions as identity objects and every definition is a function tool", () => {
  const announce = brainToolDefinitions().find((tool) => tool.name === BRAIN_TOOL.ANNOUNCE);
  assert.ok(announce);
  assert.deepEqual(announce.parameters.required, ["briefing", "session_ids"]);
  const sessionIds = announce.parameters.properties.session_ids;
  assert.ok(sessionIds?.type === "array");
  assert.ok(sessionIds.items.type === "object");
  assert.deepEqual(sessionIds.items.required, ["provider_id", "provider_session_id"]);
  for (const tool of brainToolDefinitions()) assert.equal(tool.type, "function");
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(!isBrainOnlyTool(REALTIME_TOOL.SEND_SESSION_MESSAGE));
});
