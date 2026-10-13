import assert from "node:assert/strict";
import { test } from "vitest";
import agent from "../eve/agent";
import worker from "../eve/subagents/worker/agent";
import { DEPLOYMENT_PRESENCE } from "../server/hosted/brain-host/auth";
import {
  BRAIN_HOST_TURN_POLICY,
  brainHostChannelInput,
  DEPLOYMENT_TURNS,
} from "../server/hosted/brain-host/channel";
import {
  EVE_DELEGATION_TOOL,
  planningToolDeclarations,
} from "../server/hosted/brain-host/planning";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { CONNECTION_TOOL } from "../server/hosted/connection-tools";
import { INTEGRATION } from "../server/hosted/integrations";

/**
 * What the eve agent is declared as, held to the trust decisions the host
 * carries: eve's own default tools are off, a session has no clock of eve's,
 * follow-ups queue, and the rows a turn writes are held to the very tools
 * the turn is offered.
 */

test("the agent runs none of eve's default tools and sessions have no lifetime of eve's", () => {
  assert.equal(agent.defaultTools, false);
  assert.equal(agent.limits?.sessionTimeoutMs, false);
});

test("the root caps no input tokens and the worker authors no budget of its own, so a worker runs uncapped rather than on a share of eve's default", () => {
  assert.equal(agent.limits?.maxInputTokensPerSession, false);
  assert.equal("limits" in worker, false);
});

test("a follow-up steers the turn under way rather than queueing behind it, and the account bearer is checked before the development principal", () => {
  const channel = brainHostChannelInput(
    async () => undefined,
    {
      reachesSession: async () => false,
      reachesConversation: async () => false,
    },
    { secret: undefined, admits: DEPLOYMENT_TURNS, presents: DEPLOYMENT_PRESENCE.DEPLOYMENT },
  );
  assert.equal(channel.turnPolicy, BRAIN_HOST_TURN_POLICY.STEER);
  assert.equal(Array.isArray(channel.auth), false);
});

test("the writer and the reader share one tool set, which names every planning tool a turn is offered, eve's own delegation tools, and every integration's calls, and declares no output schema", () => {
  assert.deepEqual(
    Object.keys(HOSTED_TOOL_SET).sort(),
    [
      ...planningToolDeclarations().map((declared) => declared.name),
      ...Object.values(EVE_DELEGATION_TOOL),
      ...Object.values(CONNECTION_TOOL),
      ...Object.values(INTEGRATION).map((integration) => integration.REMOTE_TOOL),
    ].sort(),
  );
  for (const declared of Object.values(HOSTED_TOOL_SET)) {
    assert.equal(declared.outputSchema, undefined);
  }
});
