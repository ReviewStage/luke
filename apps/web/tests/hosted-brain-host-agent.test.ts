import assert from "node:assert/strict";
import { NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory";
import { test } from "vitest";
import agent from "../eve/agent";
import {
  ACTION_TOOL,
  BRAIN_TOOL,
  BRAIN_TURN_TRIGGER,
  brainToolCatalog,
  TOOL_POLICY_LAYER,
} from "../server/core";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../server/hosted/brain-host/channel";
import { hostedTurnPolicy } from "../server/hosted/brain-host/tools";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";

/**
 * What the eve agent is declared as, held to the trust decisions the host
 * carries: eve's own default tools are off, a session has no clock of eve's,
 * follow-ups queue, and the hosted tool policy withholds what the service
 * cannot perform while keeping the notebook's two reads and two writes.
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

test("the hosted policy withholds skills, keeps the notebook's reads and writes, offers delegation, offers announce only to an observation, and the message send only to an ask", () => {
  const ask = hostedTurnPolicy(BRAIN_TURN_TRIGGER.ASK);
  const observation = hostedTurnPolicy(BRAIN_TURN_TRIGGER.ROSTER);
  const askNames = ask.allowed.map((tool) => tool.schema.name);
  const observationNames = observation.allowed.map((tool) => tool.schema.name);

  assert.equal(askNames.includes(BRAIN_TOOL.LOAD_SKILL), false);
  assert.equal(observationNames.includes(BRAIN_TOOL.LOAD_SKILL), false);
  for (const kept of [
    ACTION_TOOL.RUN_SESSION_CONTROL,
    BRAIN_TOOL.LIST_SESSIONS,
    BRAIN_TOOL.READ_TRANSCRIPT,
    BRAIN_TOOL.READ_WORKSPACE_FILE,
    BRAIN_TOOL.WRITE_WORKSPACE_FILE,
    BRAIN_TOOL.APPEND_DAILY_NOTE,
    BRAIN_TOOL.LIST_DAILY_NOTES,
    NOTEBOOK_MEMORY_TOOL.SEARCH,
    NOTEBOOK_MEMORY_TOOL.GET,
    BRAIN_TOOL.SESSIONS_SPAWN,
    BRAIN_TOOL.SUBAGENTS,
    BRAIN_TOOL.SESSIONS_LIST,
    BRAIN_TOOL.SESSIONS_HISTORY,
  ]) {
    assert.equal(askNames.includes(kept), true);
    assert.equal(observationNames.includes(kept), true);
  }
  assert.equal(askNames.includes(BRAIN_TOOL.ANNOUNCE), false);
  assert.equal(observationNames.includes(BRAIN_TOOL.ANNOUNCE), true);
  // An observation's lines are the developer's own words to their agent, and a message Luke
  // sent into the chat would come back as one of them: the send carries an ask and nothing else.
  assert.equal(askNames.includes(ACTION_TOOL.SEND_SESSION_MESSAGE), true);
  assert.equal(observationNames.includes(ACTION_TOOL.SEND_SESSION_MESSAGE), false);
  assert.equal(observation.deniedBy(ACTION_TOOL.SEND_SESSION_MESSAGE), TOOL_POLICY_LAYER.TURN);
});

test("a child's task is offered the ask's set less the session tools: it cannot spawn, announce, list, read, or cancel, and keeps the reads, actions, workspace, and memory", () => {
  const childTask = hostedTurnPolicy(BRAIN_TURN_TRIGGER.CHILD_TASK);
  const childTaskNames = childTask.allowed.map((tool) => tool.schema.name);
  for (const denied of [
    BRAIN_TOOL.ANNOUNCE,
    BRAIN_TOOL.SESSIONS_SPAWN,
    BRAIN_TOOL.SUBAGENTS,
    BRAIN_TOOL.SESSIONS_LIST,
    BRAIN_TOOL.SESSIONS_HISTORY,
  ]) {
    assert.equal(childTaskNames.includes(denied), false);
    assert.equal(childTask.deniedBy(denied), TOOL_POLICY_LAYER.TURN);
  }
  for (const kept of [
    BRAIN_TOOL.LIST_SESSIONS,
    BRAIN_TOOL.READ_WORKSPACE_FILE,
    BRAIN_TOOL.WRITE_WORKSPACE_FILE,
    NOTEBOOK_MEMORY_TOOL.SEARCH,
  ]) {
    assert.equal(childTaskNames.includes(kept), true);
  }
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
