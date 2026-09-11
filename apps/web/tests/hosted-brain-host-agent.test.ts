import assert from "node:assert/strict";
import { test } from "vitest";
import agent from "../agent/agent";
import { ACTION_TOOL, BRAIN_TOOL, BRAIN_TURN_TRIGGER, brainToolCatalog } from "../server/core";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../server/hosted/brain-host/channel";
import { hostedTurnPolicy } from "../server/hosted/brain-host/tools";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";

/**
 * What the eve agent is declared as, held to the trust decisions the host
 * carries: eve's own default tools are off, a session has no clock of eve's,
 * follow-ups queue, and the hosted tool policy withholds what the service
 * cannot perform while keeping the notebook's two writes.
 */

test("the agent runs none of eve's default tools and sessions have no lifetime of eve's", () => {
  assert.equal(agent.defaultTools, false);
  assert.equal(agent.limits?.sessionTimeoutMs, false);
});

test("follow-ups queue behind a turn under way, and the account bearer is checked before the development principal", () => {
  const channel = brainHostChannelInput(
    async () => undefined,
    {
      sessionOwner: async () => undefined,
      ownsConversation: async () => false,
    },
    { secret: undefined, admits: DEPLOYMENT_TURNS },
  );
  assert.equal(channel.turnPolicy, "queue");
  assert.equal(Array.isArray(channel.auth), false);
});

test("the hosted policy withholds the machine's tools and the notebook's reads, keeps its writes, and offers announce only to an observation", () => {
  const ask = hostedTurnPolicy(BRAIN_TURN_TRIGGER.ASK);
  const observation = hostedTurnPolicy(BRAIN_TURN_TRIGGER.ROSTER);
  const askNames = ask.allowed.map((tool) => tool.schema.name);
  const observationNames = observation.allowed.map((tool) => tool.schema.name);

  for (const denied of [
    ACTION_TOOL.OPEN_SESSION,
    ACTION_TOOL.CHANGE_APP_SETTING,
    ACTION_TOOL.SHOW_PANEL,
    ACTION_TOOL.OPEN_FEEDBACK_COMPOSER,
    ACTION_TOOL.RUN_UPDATE_ACTION,
    ACTION_TOOL.UPDATE_ISSUE_STATE,
    ACTION_TOOL.COMMENT_ON_ISSUE,
    BRAIN_TOOL.SESSIONS_SPAWN,
    BRAIN_TOOL.LOAD_SKILL,
    "memory_search",
    "memory_get",
  ]) {
    assert.equal(askNames.includes(denied), false);
    assert.equal(observationNames.includes(denied), false);
  }
  for (const kept of [
    ACTION_TOOL.REMEMBER_FACT,
    ACTION_TOOL.FORGET_FACT,
    ACTION_TOOL.SEND_SESSION_MESSAGE,
    BRAIN_TOOL.LIST_SESSIONS,
    BRAIN_TOOL.READ_TRANSCRIPT,
    BRAIN_TOOL.READ_WORKSPACE_FILE,
    BRAIN_TOOL.WRITE_WORKSPACE_FILE,
  ]) {
    assert.equal(askNames.includes(kept), true);
    assert.equal(observationNames.includes(kept), true);
  }
  assert.equal(askNames.includes(BRAIN_TOOL.ANNOUNCE), false);
  assert.equal(observationNames.includes(BRAIN_TOOL.ANNOUNCE), true);
});

test("the writer and the reader share one catalog tool set, which names the whole catalog and declares no output schema", () => {
  const set = CATALOG_TOOL_SET;
  assert.deepEqual(
    Object.keys(set).sort(),
    brainToolCatalog()
      .map((tool) => tool.schema.name)
      .sort(),
  );
  for (const declared of Object.values(set)) {
    assert.equal(declared.outputSchema, undefined);
  }
});
