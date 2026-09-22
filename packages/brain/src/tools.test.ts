import assert from "node:assert/strict";
import { ACTION_TOOL, actionToolDefinitions } from "@sidecar/actions";
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
import { PLAN_READS_TOOL_NAME } from "./tools/prefetch-tool.js";
import {
  BRAIN_TOOL,
  BRAIN_TOOLS,
  brainToolCatalog,
  brainToolRegistry,
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
    // Every action is the performer's to carry.
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

test("with no configured layers every turn is offered the whole catalog, less what the turn layer withholds: an ask loses announce, an observation loses the message send", () => {
  const catalog = brainToolCatalog();
  const ask = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.ASK);
  const wake = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.WAKE);
  const roster = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.ROSTER);
  const maintenance = resolveTurnToolPolicy(catalog, {});
  assert.ok(ask.allows(ACTION_TOOL.SEND_SESSION_MESSAGE));
  // An observation's lines are the developer's words to their agent, and a send would come
  // back as one of them: the send is the ask's alone, whichever observation trigger opened it.
  assert.ok(!wake.allows(ACTION_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(!roster.allows(ACTION_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(wake.allows(ACTION_TOOL.RUN_SESSION_CONTROL));
  assert.ok(wake.allows(BRAIN_TOOL.WRITE_WORKSPACE_FILE));
  assert.ok(!ask.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(wake.allows(BRAIN_TOOL.ANNOUNCE));
  assert.ok(!ask.allows("delete_everything"));
  assert.ok(!wake.allows("read_session_transcript"));
  assert.deepEqual(ask.denied, [{ tool: BRAIN_TOOL.ANNOUNCE, layer: TOOL_POLICY_LAYER.TURN }]);
  assert.deepEqual(wake.denied, [
    { tool: ACTION_TOOL.SEND_SESSION_MESSAGE, layer: TOOL_POLICY_LAYER.TURN },
  ]);
  assert.deepEqual(roster.denied, wake.denied);
  assert.deepEqual(maintenance.denied, []);
  // A configured deny still wins over the turn layer, and is the layer named.
  const configured = resolveTurnToolPolicy(
    catalog,
    { session: { deny: [BRAIN_TOOL.ANNOUNCE] } },
    BRAIN_TURN_TRIGGER.WAKE,
  );
  assert.ok(!configured.allows(BRAIN_TOOL.ANNOUNCE));
  assert.equal(configured.deniedBy(BRAIN_TOOL.ANNOUNCE), TOOL_POLICY_LAYER.SESSION);
});

test("a configured deny of the actions group removes every action and keeps the reads", () => {
  const policy = resolveToolPolicy(brainToolCatalog(), {
    agent: { deny: [`group:${TOOL_GROUP.ACTIONS}`] },
  });
  for (const tool of actionToolDefinitions()) assert.ok(!policy.allows(tool.name), tool.name);
  assert.ok(policy.allows(BRAIN_TOOL.LIST_SESSIONS));
  assert.ok(policy.allows(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(policy.allows(BRAIN_TOOL.READ_WORKSPACE_FILE));
  assert.ok(policy.allows(BRAIN_TOOL.LIST_DAILY_NOTES));
});

test("the dated-note tools stand in the workspace group: the append a write, the listing a read the read group also names", () => {
  const catalog = brainToolCatalog();
  const entryOf = (name: string) => {
    const entry = catalog.find((tool) => tool.schema.name === name);
    assert.ok(entry, name);
    return entry;
  };
  const append = entryOf(BRAIN_TOOL.APPEND_DAILY_NOTE);
  assert.equal(append.execution, TOOL_EXECUTION.WORKSPACE);
  assert.equal(append.effect, TOOL_EFFECT.WRITE);
  assert.deepEqual([...append.groups], [TOOL_GROUP.WORKSPACE]);
  const list = entryOf(BRAIN_TOOL.LIST_DAILY_NOTES);
  assert.equal(list.execution, TOOL_EXECUTION.WORKSPACE);
  assert.equal(list.effect, TOOL_EFFECT.READ);
  assert.deepEqual([...list.groups], [TOOL_GROUP.WORKSPACE, TOOL_GROUP.READ]);
  const withoutWorkspace = resolveToolPolicy(catalog, {
    agent: { deny: [`${GROUP_PREFIX}${TOOL_GROUP.WORKSPACE}`] },
  });
  assert.equal(withoutWorkspace.allows(BRAIN_TOOL.APPEND_DAILY_NOTE), false);
  assert.equal(withoutWorkspace.allows(BRAIN_TOOL.LIST_DAILY_NOTES), false);
  const withoutReads = resolveToolPolicy(catalog, {
    agent: { deny: [`${GROUP_PREFIX}${TOOL_GROUP.READ}`] },
  });
  assert.equal(withoutReads.allows(BRAIN_TOOL.APPEND_DAILY_NOTE), true);
  assert.equal(withoutReads.allows(BRAIN_TOOL.LIST_DAILY_NOTES), false);
});

test("announce takes the briefing alone and the hosted catalog carries every definition as a function tool", () => {
  const announce = hostedBrainToolCatalog().get(BRAIN_TOOL.ANNOUNCE);
  assert.ok(announce);
  assert.deepEqual(announce.parameters.required, ["briefing"]);
  assert.deepEqual(Object.keys(wireRecord(announce.parameters.properties) ?? {}), ["briefing"]);
  for (const tool of hostedBrainToolCatalog().values()) assert.equal(tool.type, "function");
  // The hosted catalog is the brain's plus the prefetch planner's one tool,
  // which no turn is offered and the service alone selects, by kind.
  assert.equal(hostedBrainToolCatalog().size, brainToolCatalog().length + 1);
  assert.equal(hostedBrainToolCatalog().has(PLAN_READS_TOOL_NAME), true);
  assert.equal(
    brainToolCatalog().some((tool) => tool.schema.name === PLAN_READS_TOOL_NAME),
    false,
  );
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(isBrainOnlyTool(BRAIN_TOOL.LOAD_SKILL));
  assert.ok(!isBrainOnlyTool(ACTION_TOOL.SEND_SESSION_MESSAGE));
});

test("a child's task turn loses announce like an ask and the whole sessions group besides, and the session tools stand in the catalog under that group", () => {
  const childTask = turnToolPolicy(BRAIN_TURN_TRIGGER.CHILD_TASK);
  assert.deepEqual(childTask.deny, [BRAIN_TOOL.ANNOUNCE, `${GROUP_PREFIX}${TOOL_GROUP.SESSIONS}`]);
  assert.deepEqual(turnToolPolicy(BRAIN_TURN_TRIGGER.ASK), { deny: [BRAIN_TOOL.ANNOUNCE] });
  assert.deepEqual(turnToolPolicy(BRAIN_TURN_TRIGGER.ROSTER), {
    deny: [ACTION_TOOL.SEND_SESSION_MESSAGE],
  });
  assert.deepEqual(
    turnToolPolicy(BRAIN_TURN_TRIGGER.WAKE),
    turnToolPolicy(BRAIN_TURN_TRIGGER.ROSTER),
  );
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
});

test("the notebook stands in the catalog under the memory group as the provider's two reads, and no action stands under it", () => {
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
  // The notebook is written through the workspace tool, which is no action and no memory tool.
  for (const tool of actionToolDefinitions()) {
    assert.equal(entryOf(tool.name).groups.includes(TOOL_GROUP.MEMORY), false, tool.name);
  }
  const written = entryOf(BRAIN_TOOL.WRITE_WORKSPACE_FILE);
  assert.equal(written.execution, TOOL_EXECUTION.WORKSPACE);
  assert.deepEqual([...written.groups], [TOOL_GROUP.WORKSPACE]);
  const denied = resolveToolPolicy(catalog, {
    agent: { deny: [`${GROUP_PREFIX}${TOOL_GROUP.MEMORY}`] },
  });
  for (const name of Object.values(NOTEBOOK_MEMORY_TOOL)) {
    assert.equal(denied.allows(name), false);
  }
  assert.equal(denied.allows(BRAIN_TOOL.READ_TRANSCRIPT), true);
  assert.equal(denied.allows(BRAIN_TOOL.WRITE_WORKSPACE_FILE), true);
  const deniedActions = resolveToolPolicy(catalog, {
    agent: { deny: [`${GROUP_PREFIX}${TOOL_GROUP.ACTIONS}`] },
  });
  assert.equal(deniedActions.allows(ACTION_TOOL.RUN_SESSION_CONTROL), false);
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
