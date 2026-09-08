import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, realtimeToolDefinitions } from "@sidecar/acts";
import { BRAIN_TURN_AUTHORITY } from "@sidecar/hosted";
import { resolveToolPolicy, TOOL_EXECUTION } from "@sidecar/runtime";
import {
  BRAIN_TOOL,
  brainToolCatalog,
  brainToolSchemas,
  defaultTurnToolPolicy,
  hostedBrainToolCatalog,
  hostedBrainV1ToolDefinitions,
  isBrainOnlyTool,
  TOOL_GROUP,
} from "./tools.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

test("the catalog holds every act and every brain tool once, each under its execution", () => {
  const catalog = brainToolCatalog();
  const names = catalog.map((tool) => tool.id);
  assert.equal(new Set(names).size, names.length);
  for (const act of realtimeToolDefinitions()) {
    const entry = catalog.find((tool) => tool.id === act.name);
    assert.ok(entry, `${act.name} is in the catalog`);
    assert.equal(entry.execution, TOOL_EXECUTION.PERFORMER);
    assert.ok(entry.groups.includes(TOOL_GROUP.ACTS));
  }
  for (const own of Object.values(BRAIN_TOOL)) {
    const entry = catalog.find((tool) => tool.id === own);
    assert.ok(entry, `${own} is in the catalog`);
    assert.notEqual(entry.execution, TOOL_EXECUTION.PERFORMER);
    assert.equal(entry.schema.name, own);
  }
  assert.equal(names.length, realtimeToolDefinitions().length + Object.values(BRAIN_TOOL).length);
});

test("with no configuration every turn is offered the whole catalog, and only an ask loses announce", () => {
  const ask = defaultTurnToolPolicy(BRAIN_TURN_TRIGGER.ASK);
  const wake = defaultTurnToolPolicy(BRAIN_TURN_TRIGGER.WAKE);
  assert.ok(ask.allows(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(wake.allows(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(wake.allows(BRAIN_TOOL.WRITE_WORKSPACE_FILE));
  assert.ok(!ask.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(wake.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(!ask.allows("delete_everything"));
  assert.ok(!wake.allows("read_session_transcript"));
  assert.deepEqual(ask.denied, [{ tool: BRAIN_TOOL.ANNOUNCE, layer: "session" }]);
  assert.equal(brainToolSchemas(wake).length, brainToolCatalog().length);
  assert.equal(brainToolSchemas(ask).length, brainToolCatalog().length - 1);
  for (const schema of brainToolSchemas(wake)) assert.ok(schema.name.length > 0);
});

test("a configured deny of the acts group removes every act and keeps the reads", () => {
  const policy = resolveToolPolicy(brainToolCatalog(), {
    agent: { deny: [`group:${TOOL_GROUP.ACTS}`] },
  });
  for (const act of realtimeToolDefinitions()) assert.ok(!policy.allows(act.name), act.name);
  assert.ok(policy.allows(BRAIN_TOOL.LIST_SESSIONS));
  assert.ok(policy.allows(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(policy.allows(BRAIN_TOOL.READ_WORKSPACE_FILE));
});

test("announce takes the briefing alone and the hosted catalog carries every definition as a function tool", () => {
  const announce = hostedBrainToolCatalog().get(BRAIN_TOOL.ANNOUNCE);
  assert.ok(announce);
  assert.deepEqual(announce.parameters.required, ["briefing"]);
  assert.deepEqual(Object.keys(announce.parameters.properties), ["briefing"]);
  for (const tool of hostedBrainToolCatalog().values()) assert.equal(tool.type, "function");
  assert.equal(hostedBrainToolCatalog().size, brainToolCatalog().length);
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.LOAD_SKILL));
  assert.ok(!isBrainOnlyTool(REALTIME_TOOL.SEND_SESSION_MESSAGE));
});

test("the first hosted contract's toolsets stand as installed clients expect them", () => {
  const developer = hostedBrainV1ToolDefinitions(BRAIN_TURN_AUTHORITY.DEVELOPER).map((t) => t.name);
  const observation = hostedBrainV1ToolDefinitions(BRAIN_TURN_AUTHORITY.OBSERVATION).map(
    (t) => t.name,
  );
  assert.equal(developer.length, realtimeToolDefinitions().length + 2);
  assert.ok(!developer.includes(BRAIN_TOOL.ANNOUNCE));
  assert.ok(!developer.includes(BRAIN_TOOL.WRITE_WORKSPACE_FILE));
  assert.deepEqual(
    [...observation].sort(),
    [BRAIN_TOOL.LIST_SESSIONS, BRAIN_TOOL.READ_TRANSCRIPT, BRAIN_TOOL.ANNOUNCE].sort(),
  );
});
