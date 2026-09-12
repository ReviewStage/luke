import assert from "node:assert/strict";
import { ACTION_FAMILY, ACTION_TOOL, actionToolDefinitions } from "@sidecar/actions";
import { NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory";
import {
  GROUP_PREFIX,
  resolveToolPolicy,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  TOOL_POLICY_LAYER,
} from "@sidecar/runtime";
import { wireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { test } from "vitest";
import { ACTION_TOOLS } from "./tools/action-tools.js";
import {
  BRAIN_TOOL,
  BRAIN_TOOLS,
  brainToolCatalog,
  brainToolRegistry,
  brainToolSchemas,
  hostedBrainToolCatalog,
  isBrainOnlyTool,
  resolveTurnToolPolicy,
  TOOL_GROUP,
  turnToolPolicy,
} from "./tools.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

test("the catalog holds every action, every brain tool, and every memory tool once, each under its execution", () => {
  const catalog = brainToolCatalog();
  const names = catalog.map((tool) => tool.schema.name);
  assert.equal(new Set(names).size, names.length);
  const memoryTools: readonly string[] = Object.values(NOTEBOOK_MEMORY_TOOL);
  for (const tool of actionToolDefinitions()) {
    const entry = catalog.find((candidate) => candidate.schema.name === tool.name);
    assert.ok(entry, `${tool.name} is in the catalog`);
    // Every action is the performer's to carry, the notebook's two writes included.
    assert.equal(entry.execution, TOOL_EXECUTION.PERFORMER);
    assert.ok(entry.groups.includes(TOOL_GROUP.ACTIONS));
  }
  for (const own of Object.values(BRAIN_TOOL)) {
    const entry = catalog.find((tool) => tool.schema.name === own);
    assert.ok(entry, `${own} is in the catalog`);
    assert.notEqual(entry.execution, TOOL_EXECUTION.PERFORMER);
    assert.notEqual(entry.execution, TOOL_EXECUTION.MEMORY);
    assert.equal(entry.schema.name, own);
  }
  for (const own of memoryTools) {
    const entry = catalog.find((tool) => tool.schema.name === own);
    assert.ok(entry, `${own} is in the catalog`);
    assert.equal(entry.execution, TOOL_EXECUTION.MEMORY);
  }
  assert.equal(
    names.length,
    actionToolDefinitions().length + Object.values(BRAIN_TOOL).length + memoryTools.length,
  );
});

test("with no configured layers every turn is offered the whole catalog, and only an ask loses announce, to the turn layer", () => {
  const catalog = brainToolCatalog();
  const ask = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.ASK);
  const wake = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.WAKE);
  const maintenance = resolveTurnToolPolicy(catalog, {});
  assert.ok(ask.allows(ACTION_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(wake.allows(ACTION_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(wake.allows(BRAIN_TOOL.WRITE_WORKSPACE_FILE));
  assert.ok(!ask.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(wake.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(!ask.allows("delete_everything"));
  assert.ok(!wake.allows("read_session_transcript"));
  assert.deepEqual(ask.denied, [{ tool: BRAIN_TOOL.ANNOUNCE, layer: TOOL_POLICY_LAYER.TURN }]);
  assert.deepEqual(maintenance.denied, []);
  // A configured deny still wins over the turn layer, and is the layer named.
  const configured = resolveTurnToolPolicy(
    catalog,
    { session: { deny: [BRAIN_TOOL.ANNOUNCE] } },
    BRAIN_TURN_TRIGGER.WAKE,
  );
  assert.ok(!configured.allows(BRAIN_TOOL.ANNOUNCE));
  assert.equal(configured.deniedBy(BRAIN_TOOL.ANNOUNCE), TOOL_POLICY_LAYER.SESSION);
  assert.equal(brainToolSchemas(wake).length, brainToolCatalog().length);
  assert.equal(brainToolSchemas(ask).length, brainToolCatalog().length - 1);
  for (const schema of brainToolSchemas(wake)) assert.ok(schema.name.length > 0);
});

test("a configured deny of the actions group removes every action and keeps the reads", () => {
  const policy = resolveToolPolicy(brainToolCatalog(), {
    agent: { deny: [`group:${TOOL_GROUP.ACTIONS}`] },
  });
  for (const tool of actionToolDefinitions()) assert.ok(!policy.allows(tool.name), tool.name);
  assert.ok(policy.allows(BRAIN_TOOL.LIST_SESSIONS));
  assert.ok(policy.allows(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(policy.allows(BRAIN_TOOL.READ_WORKSPACE_FILE));
});

test("announce takes the briefing alone and the hosted catalog carries every definition as a function tool", () => {
  const announce = hostedBrainToolCatalog().get(BRAIN_TOOL.ANNOUNCE);
  assert.ok(announce);
  assert.deepEqual(announce.parameters.required, ["briefing"]);
  assert.deepEqual(Object.keys(wireRecord(announce.parameters.properties) ?? {}), ["briefing"]);
  for (const tool of hostedBrainToolCatalog().values()) assert.equal(tool.type, "function");
  assert.equal(hostedBrainToolCatalog().size, brainToolCatalog().length);
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.LOAD_SKILL));
  assert.ok(!isBrainOnlyTool(ACTION_TOOL.SEND_SESSION_MESSAGE));
});

test("a child's task turn loses announce like an ask, and the session tools stand in the catalog under their group", () => {
  const childTask = turnToolPolicy(BRAIN_TURN_TRIGGER.CHILD_TASK);
  assert.deepEqual(childTask.deny, [BRAIN_TOOL.ANNOUNCE]);
  assert.deepEqual(turnToolPolicy(BRAIN_TURN_TRIGGER.CHILD_COMPLETION), {});
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

test("the notebook stands in the catalog under the memory group: the provider's reads as reads, its two writes as actions the performer carries", () => {
  const catalog = brainToolCatalog();
  const entryOf = (name: string) => {
    const entry = catalog.find((tool) => tool.schema.name === name);
    assert.ok(entry, name);
    return entry;
  };
  for (const name of [NOTEBOOK_MEMORY_TOOL.SEARCH, NOTEBOOK_MEMORY_TOOL.GET]) {
    const entry = entryOf(name);
    assert.equal(entry.execution, TOOL_EXECUTION.MEMORY);
    assert.equal(entry.effect, TOOL_EFFECT.READ);
    assert.deepEqual([...entry.groups], [TOOL_GROUP.MEMORY, TOOL_GROUP.READ]);
  }
  const notebookWrites = [ACTION_TOOL.REMEMBER_FACT, ACTION_TOOL.FORGET_FACT];
  for (const name of notebookWrites) {
    const entry = entryOf(name);
    assert.equal(entry.execution, TOOL_EXECUTION.PERFORMER);
    assert.equal(entry.effect, TOOL_EFFECT.WRITE);
    assert.deepEqual([...entry.groups], [TOOL_GROUP.MEMORY, TOOL_GROUP.ACTIONS, ACTION_FAMILY.APP]);
  }
  assert.equal(
    catalog.filter((tool) => tool.schema.name === ACTION_TOOL.REMEMBER_FACT).length,
    1,
    "a notebook write is listed once, as an action",
  );
  const denied = resolveToolPolicy(catalog, {
    agent: { deny: [`${GROUP_PREFIX}${TOOL_GROUP.MEMORY}`] },
  });
  for (const name of [...Object.values(NOTEBOOK_MEMORY_TOOL), ...notebookWrites]) {
    assert.equal(denied.allows(name), false);
  }
  assert.equal(denied.allows(BRAIN_TOOL.READ_TRANSCRIPT), true);
  const deniedActions = resolveToolPolicy(catalog, {
    agent: { deny: [`${GROUP_PREFIX}${TOOL_GROUP.ACTIONS}`] },
  });
  assert.equal(deniedActions.allows(ACTION_TOOL.REMEMBER_FACT), false);
  assert.equal(deniedActions.allows(NOTEBOOK_MEMORY_TOOL.SEARCH), true);
});

test("every tool the catalog lists is a module of one shape: a name, words, a wire schema, and one execute", () => {
  const modules = [...ACTION_TOOLS, ...BRAIN_TOOLS];
  const catalog = brainToolCatalog();
  const memoryTools: readonly string[] = Object.values(NOTEBOOK_MEMORY_TOOL);
  for (const entry of catalog) {
    if (memoryTools.includes(entry.schema.name)) continue;
    const module = modules.find((candidate) => candidate.name === entry.schema.name);
    assert.ok(module, `${entry.schema.name} is a module`);
    // The registry's schema is the module's own wire schema, emitted once.
    assert.deepEqual(
      entry.schema.parameters,
      JSON.parse(JSON.stringify(emitJsonSchema(module.inputSchema))),
    );
    assert.equal(entry.schema.description, module.description);
  }
  assert.equal(new Set(modules.map((module) => module.name)).size, modules.length);
  assert.equal(modules.length + memoryTools.length, catalog.length);
});

test("the registry holds every catalog tool once under its name, with the schema the catalog's parameters were emitted from", () => {
  const catalog = brainToolCatalog();
  const registry = brainToolRegistry();
  assert.deepEqual(
    [...registry.keys()],
    catalog.map((entry) => entry.schema.name),
  );
  for (const entry of catalog) {
    const registration = registry.get(entry.schema.name);
    assert.ok(registration);
    assert.equal(registration.name, entry.schema.name);
    assert.equal(registration.description, entry.schema.description);
    assert.deepEqual(
      JSON.parse(JSON.stringify(emitJsonSchema(registration.inputSchema))),
      entry.schema.parameters,
    );
  }
});
