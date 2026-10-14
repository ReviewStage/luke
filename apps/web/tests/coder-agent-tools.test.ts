import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { storeWriter } from "@luke/database/models/writer";
import { openHostedStoreTestDatabase, startPlan } from "@luke/database/testing";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "@luke/service/core";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import type { GitHubApp } from "../server/github/github-app";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import { claimRuntimeSession } from "../server/hosted/brain-host/conversation";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import type { CoderHostSeams } from "../server/hosted/coder-host/production";
import { STEER_OUTCOME } from "../server/hosted/coder-host/steer";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import {
  CODING_AGENT_TOOL_REFUSAL,
  type CodingAgentToolName,
  START_CODING_AGENT_REFUSAL,
} from "../server/hosted/coding-agent-tools";
import { modelCatalogOf, type OfferedModel } from "../server/hosted/model-catalog";
import { FAKE_CODER_REPOSITORY_FULL_NAME, fakeCoderEve } from "./support/fake-coder-eve";

/**
 * The planning model's four tools about the plan's coding agents as a coding
 * agent calls them, through the coder host's door its tool files call, over
 * the real migrations on PGlite: an agent lists, reads, messages, and starts
 * the agents on its own plan, reaching them as the deployment acting for the
 * account, under eve's id for the call, and reaches no agent of another
 * plan. Synthetic accounts, plans, and words throughout.
 */

const NOW = 1_800_000_000_000;
const CRON_SECRET = "cron-secret-1";
const EVE_ORIGIN = "https://luke.test";
const INSTRUCTION = "PR 1 merged; rebase onto main.";
const TASK = "Build PR 2 of the rollout: Copy link to section, on main.";

const CATALOG: readonly OfferedModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
];

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: CODER_TOOL_SET }));

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

/** The seams of a deployment that names its secret and eve's origin, so the plan's other agents are reached. */
const seams: CoderHostSeams = {
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    reachesSession: () => Promise.resolve(false),
    reachesConversation: () => Promise.resolve(false),
  },
  deploymentSecret: () => Redacted.make(CRON_SECRET),
  eveOrigin: () => EVE_ORIGIN,
  keys: unreached("keys"),
  fastRefused: async () => undefined,
  titleModel: () => undefined,
  research: unreached("research"),
  scriptedModel: () => false,
  now: () => NOW,
};

let minted = 0;
function mintSession(): string {
  minted += 1;
  return `wrun_01C${String(minted).padStart(22, "0")}`;
}

/** The developer's own seat in an agent's conversation, on a typed turn. */
function ownSeat(userId: string, conversationId: string): SessionAuth {
  const seat: SessionAuthContext = {
    principalId: userId,
    principalType: "user",
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
    },
  };
  return { current: seat, initiator: seat };
}

/** An agent started on the plan, its session recorded on its conversation as the store hook records it. */
async function agentOn(userId: string, planId: string) {
  const started = Option.getOrThrow(
    await database.run(
      createCodingAgent(userId, {
        planId,
        idempotencyKey: randomUUID(),
        model: CODING_AGENT_DEFAULT_CHOICE.model,
        effort: CODING_AGENT_DEFAULT_CHOICE.effort,
        planSnapshot: "# Section links",
        task: null,
        repository: FAKE_CODER_REPOSITORY_FULL_NAME,
      }),
    ),
  );
  const target = { userId, conversationId: started.agent.conversationId };
  const sessionId = mintSession();
  assert.equal(await database.run(claimRuntimeSession(target, sessionId, new Date(NOW))), true);
  return { id: started.agent.id, conversationId: target.conversationId, sessionId, target };
}

/** A plan on the fake's repository, in the account's own workspace. */
async function planOf(userId: string) {
  return database.run(
    startPlan(userId, { name: "@-mentions", repository: FAKE_CODER_REPOSITORY_FULL_NAME }),
  );
}

/** A caller of the four tools as the orchestrating agent's tool files call them, over its admitted session, under the call id given. */
async function toolsOf(
  host: CoderHost,
  agent: Awaited<ReturnType<typeof agentOn>>,
  services: Layer.Layer<GitHubApp | HttpClient.HttpClient>,
) {
  const auth = ownSeat(agent.target.userId, agent.conversationId);
  const admitted = await database.run(host.admit(auth, agent.sessionId));
  if (Result.isFailure(admitted)) return assert.fail(admitted.failure);
  return (tool: CodingAgentToolName, input: WireRecord, callId = "call-1"): Promise<WireRecord> =>
    database.run(
      host
        .codingAgents(admitted.success, tool, input, callId)
        .pipe(Effect.provide(Layer.merge(services, modelCatalogOf(CATALOG)))),
    );
}

/** The ids a list answered, in its order; the test fails where an entry names none. */
function listedIds(answer: WireRecord): string[] {
  assert.ok(Array.isArray(answer.agents), JSON.stringify(answer));
  return answer.agents.map((each) => {
    const id = isRecord(each) ? each.id : undefined;
    assert.ok(isWireString(id), JSON.stringify(answer));
    return id;
  });
}

/** The id of the agent an answer names; the test fails where it names none. */
function agentIdOf(answer: WireRecord): string {
  const id = isRecord(answer.agent) ? answer.agent.id : undefined;
  assert.ok(isWireString(id), JSON.stringify(answer));
  return id;
}

test("a coding agent lists, reads, messages, and starts the agents on its own plan, reaching them as the deployment acting for the account under eve's id for the call, so the same call run again sends and starts nothing twice", async () => {
  const userId = await database.createUser();
  const plan = await planOf(userId);
  const orchestrator = await agentOn(userId, plan.id);
  const builder = await agentOn(userId, plan.id);
  const eve = await fakeCoderEve(database.run, plan.workspaceId, mintSession);
  const call = await toolsOf(coderHost(seams), orchestrator, eve.services);

  assert.deepEqual(listedIds(await call(AGENT_TOOL.LIST_CODING_AGENTS, {})), [
    orchestrator.id,
    builder.id,
  ]);
  const read = await call(AGENT_TOOL.READ_CODING_AGENT, { agentId: builder.id });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(read));
  assert.equal(agentIdOf(read), builder.id);

  const sent = await call(AGENT_TOOL.MESSAGE_CODING_AGENT, {
    agentId: builder.id,
    text: INSTRUCTION,
  });
  assert.deepEqual(sent, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    delivery: STEER_OUTCOME.SENT,
    agent: { id: builder.id, status: CODING_AGENT_STATUS.RUNNING },
  });
  assert.equal(eve.sent.length, 1);
  const [message] = eve.sent;
  assert.equal(message?.path, `/eve/coder/v1/session/${builder.sessionId}`);
  assert.equal(message?.headers.get("authorization"), `Bearer ${CRON_SECRET}`);
  assert.equal(message?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), userId);
  assert.equal(message?.headers.get(BRAIN_HOST_HEADER.CONVERSATION), builder.conversationId);
  assert.deepEqual(JSON.parse(message?.body ?? ""), { message: INSTRUCTION });
  const resent = await call(AGENT_TOOL.MESSAGE_CODING_AGENT, {
    agentId: builder.id,
    text: INSTRUCTION,
  });
  assert.equal(resent.delivery, STEER_OUTCOME.REPEATED);
  assert.equal(eve.sent.length, 1);

  const started = await call(AGENT_TOOL.START_CODING_AGENT, { task: TASK }, "call-2");
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  const childId = agentIdOf(started);
  const child = Option.getOrThrow(await database.run(readCodingAgent(userId, childId)));
  assert.equal(child.planId, plan.id);
  assert.equal(child.task, TASK);
  assert.equal(eve.sent.length, 2);
  assert.equal(eve.sent[1]?.path, "/eve/coder/v1/session");
  assert.equal(eve.sent[1]?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), userId);
  assert.equal(JSON.parse(eve.sent[1]?.body ?? "").message, TASK);
  // The same call run again is the same agent, and opens nothing again.
  assert.equal(
    agentIdOf(await call(AGENT_TOOL.START_CODING_AGENT, { task: TASK }, "call-2")),
    childId,
  );
  assert.equal(eve.sent.length, 2);
  assert.deepEqual(listedIds(await call(AGENT_TOOL.LIST_CODING_AGENTS, {})), [
    orchestrator.id,
    builder.id,
    childId,
  ]);
});

test("a coding agent reaches no agent of another plan, its account's own included, and a deployment that names no secret starts and sends nothing", async () => {
  const userId = await database.createUser();
  const plan = await planOf(userId);
  const other = await planOf(userId);
  const orchestrator = await agentOn(userId, plan.id);
  const elsewhere = await agentOn(userId, other.id);
  const eve = await fakeCoderEve(database.run, plan.workspaceId, mintSession);
  const call = await toolsOf(coderHost(seams), orchestrator, eve.services);

  assert.deepEqual(listedIds(await call(AGENT_TOOL.LIST_CODING_AGENTS, {})), [orchestrator.id]);
  const refused = {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT,
  };
  assert.deepEqual(await call(AGENT_TOOL.READ_CODING_AGENT, { agentId: elsewhere.id }), refused);
  assert.deepEqual(
    await call(AGENT_TOOL.MESSAGE_CODING_AGENT, { agentId: elsewhere.id, text: INSTRUCTION }),
    refused,
  );
  assert.equal(eve.sent.length, 0);

  const unsecured = await toolsOf(
    coderHost({ ...seams, deploymentSecret: () => undefined }),
    orchestrator,
    eve.services,
  );
  assert.deepEqual(await unsecured(AGENT_TOOL.START_CODING_AGENT, { task: TASK }, "call-3"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.NO_SERVICE,
  });
  assert.equal(eve.sent.length, 0);
});
