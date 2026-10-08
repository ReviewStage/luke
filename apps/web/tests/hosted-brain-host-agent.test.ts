import assert from "node:assert/strict";
import { test } from "vitest";
import agent from "../eve/agent";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../server/hosted/brain-host/channel";
import {
  EVE_DELEGATION_TOOL,
  planningToolDeclarations,
} from "../server/hosted/brain-host/planning";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";

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

test("the writer and the reader share one tool set, which names every planning tool a turn is offered and eve's own delegation tools, and declares no output schema", () => {
  assert.deepEqual(
    Object.keys(HOSTED_TOOL_SET).sort(),
    [
      ...planningToolDeclarations().map((declared) => declared.name),
      ...Object.values(EVE_DELEGATION_TOOL),
    ].sort(),
  );
  for (const declared of Object.values(HOSTED_TOOL_SET)) {
    assert.equal(declared.outputSchema, undefined);
  }
});
