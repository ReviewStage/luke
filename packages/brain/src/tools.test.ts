import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, realtimeToolDefinitions } from "@sidecar/actions";
import {
  GROUP_PREFIX,
  resolveToolPolicy,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  TOOL_POLICY_LAYER,
} from "@sidecar/runtime";
import { wireRecord } from "@sidecar/wire";
import {
  BRAIN_TOOL,
  brainToolCatalog,
  brainToolSchemas,
  hostedBrainToolCatalog,
  isBrainOnlyTool,
  resolveTurnToolPolicy,
  TOOL_GROUP,
  turnToolPolicy,
} from "./tools.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

test("the catalog holds every action and every brain tool once, each under its execution", () => {
  const catalog = brainToolCatalog();
  const names = catalog.map((tool) => tool.schema.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of realtimeToolDefinitions()) {
    const entry = catalog.find((candidate) => candidate.schema.name === tool.name);
    assert.ok(entry, `${tool.name} is in the catalog`);
    assert.equal(entry.execution, TOOL_EXECUTION.PERFORMER);
    assert.ok(entry.groups.includes(TOOL_GROUP.ACTIONS));
  }
  for (const own of Object.values(BRAIN_TOOL)) {
    const entry = catalog.find((tool) => tool.schema.name === own);
    assert.ok(entry, `${own} is in the catalog`);
    assert.notEqual(entry.execution, TOOL_EXECUTION.PERFORMER);
    assert.equal(entry.schema.name, own);
  }
  assert.equal(names.length, realtimeToolDefinitions().length + Object.values(BRAIN_TOOL).length);
});

test("with no configured layers every turn is offered the whole catalog, and announce is offered only in a tick, at the turn layer", () => {
  const catalog = brainToolCatalog();
  const ask = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.ASK);
  const tick = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.TICK);
  const maintenance = resolveTurnToolPolicy(catalog, {});
  assert.ok(ask.allows(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(tick.allows(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(tick.allows(BRAIN_TOOL.WRITE_WORKSPACE_FILE));
  assert.ok(!ask.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(tick.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(!ask.allows("delete_everything"));
  assert.ok(!tick.allows("read_session_transcript"));
  assert.deepEqual(ask.denied, [{ tool: BRAIN_TOOL.ANNOUNCE, layer: TOOL_POLICY_LAYER.TURN }]);
  assert.deepEqual(maintenance.denied, []);
  for (const trigger of Object.values(BRAIN_TURN_TRIGGER)) {
    const offered = resolveTurnToolPolicy(catalog, {}, trigger).allows(BRAIN_TOOL.ANNOUNCE);
    assert.equal(offered, trigger === BRAIN_TURN_TRIGGER.TICK, trigger);
  }
  // A configured deny still wins over the turn layer, and is the layer named.
  const configured = resolveTurnToolPolicy(
    catalog,
    { session: { deny: [BRAIN_TOOL.ANNOUNCE] } },
    BRAIN_TURN_TRIGGER.TICK,
  );
  assert.ok(!configured.allows(BRAIN_TOOL.ANNOUNCE));
  assert.equal(configured.deniedBy(BRAIN_TOOL.ANNOUNCE), TOOL_POLICY_LAYER.SESSION);
  assert.equal(brainToolSchemas(tick).length, brainToolCatalog().length);
  assert.equal(brainToolSchemas(ask).length, brainToolCatalog().length - 1);
  for (const schema of brainToolSchemas(tick)) assert.ok(schema.name.length > 0);
});

test("a configured deny of the actions group removes every action and keeps the reads", () => {
  const policy = resolveToolPolicy(brainToolCatalog(), {
    agent: { deny: [`group:${TOOL_GROUP.ACTIONS}`] },
  });
  for (const tool of realtimeToolDefinitions()) assert.ok(!policy.allows(tool.name), tool.name);
  assert.ok(policy.allows(BRAIN_TOOL.LIST_SESSIONS));
  assert.ok(policy.allows(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(policy.allows(BRAIN_TOOL.READ_WORKSPACE_FILE));
});

test("announce takes the text alone and the hosted catalog carries every definition as a function tool", () => {
  const announce = hostedBrainToolCatalog().get(BRAIN_TOOL.ANNOUNCE);
  assert.ok(announce);
  assert.deepEqual(announce.parameters.required, ["text"]);
  assert.deepEqual(Object.keys(wireRecord(announce.parameters.properties) ?? {}), ["text"]);
  for (const tool of hostedBrainToolCatalog().values()) assert.equal(tool.type, "function");
  assert.equal(hostedBrainToolCatalog().size, brainToolCatalog().length);
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.LOAD_SKILL));
  assert.ok(!isBrainOnlyTool(REALTIME_TOOL.SEND_SESSION_MESSAGE));
});

test("a child's turns lose announce like an ask, and the session tools stand in the catalog under their group", () => {
  assert.deepEqual(turnToolPolicy(BRAIN_TURN_TRIGGER.CHILD_TASK).deny, [BRAIN_TOOL.ANNOUNCE]);
  assert.deepEqual(turnToolPolicy(BRAIN_TURN_TRIGGER.CHILD_COMPLETION).deny, [BRAIN_TOOL.ANNOUNCE]);
  assert.deepEqual(turnToolPolicy(BRAIN_TURN_TRIGGER.TICK), {});
  const catalog = brainToolCatalog();
  for (const name of [
    BRAIN_TOOL.SESSIONS_SPAWN,
    BRAIN_TOOL.SUBAGENTS,
    BRAIN_TOOL.SESSIONS_LIST,
    BRAIN_TOOL.SESSIONS_HISTORY,
  ]) {
    const tool = catalog.find((held) => held.schema.name === name);
    assert.ok(tool, name);
    assert.ok(tool.groups.includes(TOOL_GROUP.SESSIONS));
  }
  // At the depth cap the child restriction removes every session tool; below it, delegation stays.
  const capped = resolveToolPolicy(catalog, {}, { depth: 5 });
  const below = resolveToolPolicy(catalog, {}, { depth: 1 });
  assert.equal(capped.allows(BRAIN_TOOL.SESSIONS_SPAWN), false);
  assert.equal(capped.allows(BRAIN_TOOL.SESSIONS_HISTORY), false);
  assert.equal(below.allows(BRAIN_TOOL.SESSIONS_SPAWN), true);
  assert.equal(below.allows(BRAIN_TOOL.SUBAGENTS), true);
});

test("the memory tools stand in the catalog as host reads under their own group", () => {
  const catalog = brainToolCatalog();
  for (const name of [BRAIN_TOOL.MEMORY_SEARCH, BRAIN_TOOL.MEMORY_GET]) {
    const entry = catalog.find((tool) => tool.schema.name === name);
    assert.ok(entry, name);
    assert.equal(entry.execution, TOOL_EXECUTION.HOST);
    assert.equal(entry.effect, TOOL_EFFECT.READ);
    assert.ok(entry.groups.includes(TOOL_GROUP.MEMORY));
    assert.ok(entry.groups.includes(TOOL_GROUP.READ));
  }
  const denied = resolveToolPolicy(catalog, {
    agent: { deny: [`${GROUP_PREFIX}${TOOL_GROUP.MEMORY}`] },
  });
  assert.equal(denied.allows(BRAIN_TOOL.MEMORY_SEARCH), false);
  assert.equal(denied.allows(BRAIN_TOOL.MEMORY_GET), false);
  assert.equal(denied.allows(BRAIN_TOOL.READ_TRANSCRIPT), true);
});
