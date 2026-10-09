import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import agent from "../coder/agent";
import { BRAIN_HOST_TURN_POLICY } from "../server/hosted/brain-host/channel";
import { coderChannelInput } from "../server/hosted/coder-host/channel";
import { coderInstructions } from "../server/hosted/coder-host/instructions";
import { CODER_TOOL, CODER_TOOL_SET, SANDBOX_TOOLS } from "../server/hosted/coder-host/tool-set";

/**
 * What the coding agent is declared as, held to the decisions the plan
 * carries: eve's own default tools are off and the tools authored under
 * `coder/tools/` are exactly the set the store writer registers, the
 * session's input tokens are uncapped, a follow-up waits for the turn
 * under way, the deployment acts for nobody at the service's door, and the
 * session is told its commits are the developer's, whose identity the
 * checkout set and the session never changes.
 */

const TOOLS_DIRECTORY = join(import.meta.dirname, "..", "coder", "tools");

test("the agent runs none of eve's default tools, caps no input tokens, and has no lifetime of eve's", () => {
  assert.equal(agent.defaultTools, false);
  assert.equal(agent.limits?.maxInputTokensPerSession, false);
  assert.equal(agent.limits?.sessionTimeoutMs, false);
  assert.deepEqual(Object.keys(agent.limits ?? {}).sort(), [
    "maxInputTokensPerSession",
    "sessionTimeoutMs",
  ]);
});

test("the tools authored for the agent are exactly the writer's tool set, with every sandbox tool among them", () => {
  const authored: string[] = readdirSync(TOOLS_DIRECTORY)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.slice(0, -".ts".length))
    .sort();
  const authoredSet = new Set(authored);
  for (const name of SANDBOX_TOOLS) assert.ok(authoredSet.has(name), name);
  assert.deepEqual(authored, Object.keys(CODER_TOOL_SET).sort());
  assert.deepEqual(authored, Object.values(CODER_TOOL).sort());
});

test("a follow-up steers the turn under way, and the walk is the account's bearer with no deployment actor", () => {
  const channel = coderChannelInput(async () => undefined, {
    sessionOwner: async () => undefined,
    ownsConversation: async () => false,
  });
  assert.equal(channel.turnPolicy, BRAIN_HOST_TURN_POLICY.STEER);
  assert.equal(Array.isArray(channel.auth), false);
});

test("the session is told the checkout's commit identity is the developer's and never its own to change", () => {
  const instructions = coderInstructions("Acme/Relay");
  for (const kept of ["user.name", "user.email", "--author", "luke.commitTrailer"]) {
    assert.ok(instructions.includes(kept), kept);
  }
});
