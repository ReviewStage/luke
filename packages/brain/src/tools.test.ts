import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL, realtimeToolDefinitions } from "@sidecar/acts";
import { BRAIN_TURN_AUTHORITY } from "@sidecar/hosted";
import {
  createRuntimeRegistries,
  GROUP_PREFIX,
  resolveToolPolicy,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  TOOL_POLICY_LAYER,
} from "@sidecar/runtime";
import { wireRecord } from "@sidecar/wire";
import {
  NOTEBOOK_MEMORY_PROVIDER_ID,
  notebookMemoryProviderFor,
  registerBrainBuiltIns,
} from "./builtins.js";
import {
  BRAIN_TOOL,
  brainToolCatalog,
  brainToolSchemas,
  hostedBrainToolCatalog,
  hostedBrainV1ToolDefinitions,
  isBrainOnlyTool,
  resolveTurnToolPolicy,
  TOOL_GROUP,
  turnToolPolicy,
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

test("with no configured layers every turn is offered the whole catalog, and only an ask loses announce, to the turn layer", () => {
  const catalog = brainToolCatalog();
  const ask = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.ASK);
  const wake = resolveTurnToolPolicy(catalog, {}, BRAIN_TURN_TRIGGER.WAKE);
  const maintenance = resolveTurnToolPolicy(catalog, {});
  assert.ok(ask.allows(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(wake.allows(REALTIME_TOOL.SEND_SESSION_MESSAGE));
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
  assert.deepEqual(Object.keys(wireRecord(announce.parameters.properties) ?? {}), ["briefing"]);
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
    const tool = catalog.find((held) => held.id === name);
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
    const entry = catalog.find((tool) => tool.id === name);
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

test("the built-ins register the notebook index as a memory provider per embedding adapter", () => {
  const registries = registerBrainBuiltIns(createRuntimeRegistries());
  assert.deepEqual(
    registries.memoryProviders.entries().map((entry) => [entry.id, entry.embeddingAdapterId]),
    [
      [NOTEBOOK_MEMORY_PROVIDER_ID.OPENAI, "openai-embeddings"],
      [NOTEBOOK_MEMORY_PROVIDER_ID.HOSTED, "hosted-embeddings"],
    ],
  );
  assert.equal(notebookMemoryProviderFor("provider-key"), NOTEBOOK_MEMORY_PROVIDER_ID.OPENAI);
  assert.equal(notebookMemoryProviderFor("hosted-account"), NOTEBOOK_MEMORY_PROVIDER_ID.HOSTED);
  for (const provider of registries.memoryProviders.entries()) {
    assert.deepEqual([...provider.capabilities], ["keyword", "vector", "notebook"]);
  }
});
