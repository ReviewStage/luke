import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { CODING_AGENT_BRIEF } from "@sidecar/hosted/coding-agent-wire";
import { test } from "vitest";
import agent from "../coder/agent";
import worker from "../coder/subagents/worker/agent";
import { BRAIN_HOST_TURN_POLICY } from "../server/hosted/brain-host/channel";
import { CODER } from "../server/hosted/coder-host/bounds";
import { coderChannelInput } from "../server/hosted/coder-host/channel";
import { coderInstructions } from "../server/hosted/coder-host/instructions";
import {
  CODER_TOOL,
  CODER_TOOL_SET,
  SANDBOX_TOOLS,
  WORKER_TOOL_NAMES,
} from "../server/hosted/coder-host/tool-set";

/**
 * What the coding agent is declared as, held to the decisions the plan
 * carries: eve's own default tools are off and the tools authored under
 * `coder/tools/` are exactly the set the store writer registers, the
 * session's input tokens are uncapped, a follow-up waits for the turn
 * under way, the deployment acts for nobody at the service's door, and the
 * session is told its commits are the developer's, whose identity the
 * checkout set and the session never changes. The worker it delegates to
 * is hidden behind the delegation tool, bounded, and authored exactly the
 * read-only tools.
 */

const TOOLS_DIRECTORY = join(import.meta.dirname, "..", "coder", "tools");
const WORKER_TOOLS_DIRECTORY = join(
  import.meta.dirname,
  "..",
  "coder",
  "subagents",
  "worker",
  "tools",
);

/** The tools authored under a directory, by the name eve mounts each under. */
function authoredTools(directory: string): readonly string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.slice(0, -".ts".length))
    .sort();
}

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
  const authored = authoredTools(TOOLS_DIRECTORY);
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
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const instructions = coderInstructions("Acme/Relay", brief);
    for (const kept of ["user.name", "user.email", "--author", "luke.commitTrailer"]) {
      assert.ok(instructions.includes(kept), `${brief}: ${kept}`);
    }
  }
});

test("the session is told its shell starts in the checkout and its file tools take absolute paths under it", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const instructions = coderInstructions("Acme/Relay", brief);
    for (const kept of ["never open a command with a `cd`", "absolute paths", "`root`"]) {
      assert.ok(instructions.includes(kept), `${brief}: ${kept}`);
    }
  }
});

test("the worker is hidden behind the delegation tool, bounded per session, and authored exactly the read-only tools, with nothing that writes or publishes among them", () => {
  assert.equal(worker.tool, false);
  assert.equal(worker.defaultTools, false);
  assert.equal(worker.limits?.maxInputTokensPerSession, CODER.WORKER_INPUT_TOKENS);
  assert.equal(worker.limits?.maxOutputTokensPerSession, CODER.WORKER_OUTPUT_TOKENS);
  const authored = authoredTools(WORKER_TOOLS_DIRECTORY);
  assert.deepEqual(authored, [...WORKER_TOOL_NAMES].sort());
  for (const writes of [CODER_TOOL.WRITE_FILE, CODER_TOOL.APPLY_PATCH, CODER_TOOL.DELEGATE]) {
    assert.ok(!authored.includes(writes), writes);
  }
});

test("the session is told when to delegate, how to choose a worker's model, and that a worker is read-only", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const instructions = coderInstructions("Acme/Relay", brief);
    for (const kept of [
      `\`${CODER_TOOL.DELEGATE}\``,
      "run at once",
      "cheaper or faster model",
      "read-only",
    ]) {
      assert.ok(instructions.includes(kept), `${brief}: ${kept}`);
    }
  }
});

test("an agent handed a task is told its job is the developer's task, in the same repository, and is told of no plan", () => {
  const planned = coderInstructions("Acme/Relay", CODING_AGENT_BRIEF.PLAN);
  assert.ok(planned.includes("implement the plan given as the first message"));
  const tasked = coderInstructions("Acme/Relay", CODING_AGENT_BRIEF.TASK);
  assert.ok(tasked.includes("carry out the task the developer gave as the first message"));
  assert.ok(tasked.includes("`Acme/Relay`"));
  assert.doesNotMatch(tasked, /\bplan\b/iu);
});
