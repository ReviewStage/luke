import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { CODING_AGENT_BRIEF } from "@sidecar/hosted/coding-agent-wire";
import { Redacted } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { test } from "vitest";
import agent from "../coder/agent";
import worker from "../coder/subagents/worker/agent";
import { DEPLOYMENT_PRESENCE, lukeAccount } from "../server/hosted/brain-host/auth";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import { BRAIN_HOST_TURN_POLICY } from "../server/hosted/brain-host/channel";
import { CODER } from "../server/hosted/coder-host/bounds";
import { CODER_DEPLOYMENT_TURNS, coderChannelInput } from "../server/hosted/coder-host/channel";
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
 * session's input tokens are uncapped, a follow-up steers the turn under
 * way, the deployment is admitted at the service's door for the one typed
 * line the voice brain sends an account's own agent and nothing else, and
 * the session is told its commits are the developer's, whose identity the
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

const SECRET = "cron-secret-1";
const ACCOUNT = "user-a";
const CONVERSATION = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";
const OWN_SESSION = "wrun_01SESSIONOFACCOUNTA0000000";
const OTHER_SESSION = "wrun_01SESSIONOFACCOUNTB0000000";

/** What the door answered: the principal it admitted, or the word it refused with. */
type DoorAnswer =
  | { readonly admitted: SessionAuthContext; readonly refused?: undefined }
  | { readonly refused: string; readonly admitted?: undefined };

/** The deployment's request on an agent's session under its secret, naming the account, the conversation, and the kind of turn given. */
function deploymentRequest(sessionId: string, turn: string | undefined, method = "POST"): Request {
  return new Request(`https://luke.test/eve/v1/session/${sessionId}`, {
    method,
    headers: {
      authorization: `Bearer ${SECRET}`,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      ...(turn === undefined ? undefined : { [BRAIN_HOST_HEADER.TURN]: turn }),
    },
  });
}

/** The deployment's opening of an agent's session under its secret, naming the account, the conversation, and the kind of turn given. */
function deploymentOpening(turn: string): Request {
  return new Request("https://luke.test/eve/v1/session", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      [BRAIN_HOST_HEADER.TURN]: turn,
    },
  });
}

test("a follow-up steers the turn under way; the deployment's typed line on the named account's own agent session, and its typed opening of the account's own conversation, are minted as the developer's own principal, authenticator, type, and id, which is what eve steers the running turn on, with the deployment named as its carrier; a spoken turn, a stream, and another account's session are refused", async () => {
  const channel = coderChannelInput(
    async () => undefined,
    {
      sessionOwner: async (sessionId) => (sessionId === OWN_SESSION ? ACCOUNT : "user-b"),
      ownsConversation: async (userId, conversationId) =>
        userId === ACCOUNT && conversationId === CONVERSATION,
    },
    {
      secret: Redacted.make(SECRET),
      admits: CODER_DEPLOYMENT_TURNS,
      presents: DEPLOYMENT_PRESENCE.ACCOUNT,
    },
  );
  assert.equal(channel.turnPolicy, BRAIN_HOST_TURN_POLICY.STEER);
  const door = async (request: Request): Promise<DoorAnswer> => {
    const answer = await routeAuth(request, channel.auth);
    if (!(answer instanceof Response)) return { admitted: answer };
    // SAFETY: eve's own refusal body, whose `error` field is the word the door threw.
    const refusal = (await answer.json()) as { error: string };
    return { refused: refusal.error };
  };

  // The developer's own follow-up on the same session, as the agent's turn runs under it.
  const developer = await lukeAccount(async () => ACCOUNT)(
    new Request(`https://luke.test/eve/v1/session/${OWN_SESSION}`, {
      method: "POST",
      headers: {
        authorization: "Bearer developer-token",
        [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
        [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
      },
    }),
  );
  const { admitted: carried } = await door(deploymentRequest(OWN_SESSION, BRAIN_HOST_TURN.TYPED));
  assert.ok(developer);
  assert.ok(carried);
  assert.deepEqual(
    [carried.authenticator, carried.principalType, carried.principalId],
    [developer.authenticator, developer.principalType, developer.principalId],
  );
  assert.deepEqual(carried.attributes, {
    ...developer.attributes,
    [BRAIN_HOST_ATTRIBUTE.CARRIER]: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  });

  // The start of an agent: the deployment opens the account's own conversation as the developer too.
  const { admitted: opened } = await door(deploymentOpening(BRAIN_HOST_TURN.TYPED));
  assert.ok(opened);
  assert.deepEqual(
    [opened.authenticator, opened.principalType, opened.principalId, opened.attributes],
    [developer.authenticator, developer.principalType, developer.principalId, carried.attributes],
  );

  assert.deepEqual(await door(deploymentRequest(OWN_SESSION, BRAIN_HOST_TURN.SPOKEN)), {
    refused: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT,
  });
  assert.deepEqual(await door(deploymentOpening(BRAIN_HOST_TURN.SPOKEN)), {
    refused: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT,
  });
  assert.deepEqual(
    await door(deploymentRequest(`${OWN_SESSION}/stream`, BRAIN_HOST_TURN.TYPED, "GET")),
    { refused: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT },
  );
  assert.deepEqual(await door(deploymentRequest(OTHER_SESSION, BRAIN_HOST_TURN.TYPED)), {
    refused: BRAIN_HOST_REFUSAL.NOT_OWNER,
  });
});

test("the session is told the checkout's commit identity is the developer's and never its own to change", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const instructions = coderInstructions("Acme/Relay", brief);
    for (const kept of ["user.name", "user.email", "--author", "luke.commitTrailer"]) {
      assert.ok(instructions.includes(kept), `${brief}: ${kept}`);
    }
  }
});

test("the session is told its shell and its file tools start in the checkout", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const instructions = coderInstructions("Acme/Relay", brief);
    for (const kept of [
      "never open a command with a `cd`",
      "relative path is resolved from the checkout",
    ]) {
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

test("an agent handed the plan is told how to update it, and one handed a task is not", () => {
  assert.ok(coderInstructions("Acme/Relay", CODING_AGENT_BRIEF.PLAN).includes("`edit_plan`"));
  assert.ok(!coderInstructions("Acme/Relay", CODING_AGENT_BRIEF.TASK).includes("edit_plan"));
});
