import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { Effect, type Layer, Option, Redacted, Result } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  isWireString,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  type StoredUIMessage,
  sessionKey,
  TURN_ORIGIN,
  type WireRecord,
} from "../server/core";
import type { GitHubApp } from "../server/github/github-app";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import {
  claimRuntimeSession,
  conversationOwnedBy,
  runtimeSessionOwner,
} from "../server/hosted/brain-host/conversation";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import { childConversationId, hostTurnId, sentLineId } from "../server/hosted/brain-host/ids";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { memoryRelayState } from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { STEER_OUTCOME } from "../server/hosted/coder-host/steer";
import { CODER_TOOL, CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { createCodingAgent } from "../server/hosted/coding-agent-store";
import {
  CODING_AGENT_TOOL_BOUNDS,
  CODING_AGENT_TOOL_REFUSAL,
  LIST_CODING_AGENTS_TOOL,
  MESSAGE_CODING_AGENT_TOOL,
  READ_CODING_AGENT_TOOL,
} from "../server/hosted/coding-agent-tools";
import { createPlan, openPlanConversation } from "../server/hosted/plan-store";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { listJournals, sentLineStands } from "../server/hosted/store/message-reads";
import { stampedEveEvent } from "./support/eve-events";
import { githubReaching, NO_GITHUB, openGithubUser } from "./support/github-app-fake";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * The planning tools as eve runs them through the host's `runTool`, over the
 * real migrations on PGlite: a call is carried under the plan the admitted
 * conversation belongs to, and answers why it ran nothing, as a result the
 * model reads, for a name the turn was not offered, a conversation no plan
 * names, or an input that does not read. Synthetic accounts and plans
 * throughout.
 */

const NOW = 1_800_000_000_000;

const QUESTION = {
  question: "Should a withdrawn invite tell the invitee who withdrew it?",
  recommendation: "No: just say the invite is no longer valid.",
} as const;

/** A tool the brain was once offered and a planning turn is not. */
const UNOFFERED_TOOL = "write_workspace_file";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
/** The coding agents' own writer, which is what writes an agent's turn into its conversation. */
const coderWriter = await database.run(storeWriter({ tools: CODER_TOOL_SET }));

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;
const CRON_SECRET = "cron-secret-1";
const EVE_ORIGIN = "https://luke.test";
const BRANCH = "luke/teammate-invitations";
const AGENT_WORDS = "Pushed the branch.";
const INSTRUCTION = "Also add tests for the expiry.";

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    sessionOwner: (sessionId) => database.run(runtimeSessionOwner(sessionId)),
    ownsConversation: (userId, conversationId) =>
      database.run(conversationOwnedBy(userId, conversationId)),
  },
  openAi: () => undefined,
  deploymentSecret: () => undefined,
  eveOrigin: () => undefined,
  scriptedModel: () => true,
  spend: unreached("spend"),
  now: () => NOW,
};

let minted = 0;

function sessionId(): string {
  minted += 1;
  return `wrun_01T${String(minted).padStart(22, "0")}`;
}

function seat(target: ConversationTarget): SessionAuth {
  const own: SessionAuthContext = {
    principalId: target.userId,
    principalType: "user",
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: target.conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
    },
  };
  return { current: own, initiator: own };
}

function toolContext(id: string, auth: SessionAuth, name: string): EveToolContext {
  return {
    session: { id, auth, turn: { id: "turn_0", sequence: 0 } },
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: name,
    messages: [],
    getToken: unreached("getToken"),
    requireAuth: unreached("requireAuth"),
    getSandbox: unreached("getSandbox"),
  };
}

/** A tool caller over one session claimed on the conversation, as the store hook claims it at the session's start; the services are what a call may reach. */
async function callerOn(
  host: BrainHost,
  target: ConversationTarget,
  services: Layer.Layer<GitHubApp | HttpClient.HttpClient> = NO_GITHUB,
): Promise<(name: string, input: WireRecord) => Promise<WireRecord>> {
  const id = sessionId();
  const auth = seat(target);
  const starting = await database.run(host.admitStarting(auth, id));
  if (Result.isFailure(starting)) return assert.fail(starting.failure);
  assert.equal(await database.run(host.sessionStarted(starting.success, id)), true);
  const binding = {
    target,
    turn: {
      kind: BRAIN_HOST_TURN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      turnId: hostTurnId(id, "turn_0"),
    },
  };
  return (name, input) =>
    database.run(
      host
        .runTool(name, binding, input, toolContext(id, auth, name))
        .pipe(Effect.provide(services)),
    );
}

/** A plan's own conversation, opened as the Plans tab opens it, on the repository where one is named. */
async function planConversation(
  userId?: string,
  repository?: string,
): Promise<ConversationTarget & { readonly planId: string }> {
  const owner = userId ?? (await database.createUser());
  const name = "Teammate invitations";
  const plan = await database.run(
    createPlan(owner, repository === undefined ? { name } : { name, repository }),
  );
  const conversationId = Option.getOrThrow(
    await database.run(openPlanConversation(owner, plan.id)),
  );
  return { userId: owner, conversationId, planId: plan.id };
}

/** An agent started on the plan, the session eve runs it in recorded on its conversation as the store hook records it. */
async function agentOn(
  userId: string,
  planId: string,
): Promise<ConversationTarget & { readonly id: string; readonly sessionId: string }> {
  const started = Option.getOrThrow(
    await database.run(
      createCodingAgent(userId, {
        planId,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        planSnapshot: "# Teammate invitations",
        task: null,
        repository: RELAY_FULL_NAME,
      }),
    ),
  );
  const target = { userId, conversationId: started.agent.conversationId };
  const session = sessionId();
  assert.equal(await database.run(claimRuntimeSession(target, session, new Date(NOW))), true);
  return { ...target, id: started.agent.id, sessionId: session };
}

/** One turn of the agent's, still under way, with the commands it ran and its words so far, written as the relay writes them. */
async function agentRan(
  target: ConversationTarget,
  commands: readonly string[],
  words: string,
): Promise<void> {
  const turnId = randomUUID();
  const conversationId = sessionKey(target.conversationId);
  const journal: StoredUIMessage = {
    id: randomUUID(),
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts: [
      ...commands.map((command, index) => ({
        type: `tool-${CODER_TOOL.BASH}` as const,
        toolCallId: `call-${index}`,
        state: "output-available" as const,
        input: { command },
        output: { status: "completed", exitCode: 0, stdout: "", stderr: "" },
      })),
      { type: "text" as const, text: words },
    ],
  };
  await database.run(
    Effect.gen(function* () {
      yield* coderWriter.enqueueTurn(target, {
        turnId,
        origin: TURN_ORIGIN.TYPED,
        eveTurnId: "turn_0",
      });
      yield* coderWriter.consume(target, {
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        conversationId,
        turnId,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: NOW,
      });
      yield* coderWriter.consume(target, {
        kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        conversationId,
        turnId,
        sequence: 2,
        message: journal,
      });
    }),
  );
}

/** eve's coding-agent service as a script beside the fake GitHub: every message to a session answered taken, and written down. */
function fakeCoderEve() {
  const sent: { readonly path: string; readonly headers: Headers; readonly body: string }[] = [];
  const github = githubReaching([INSTALLATION], undefined, undefined, (request) => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/eve/coder/v1/session/")) return undefined;
    sent.push({ path: pathname, headers: request.headers, body: request.body });
    return Response.json(
      { sessionId: pathname.slice("/eve/coder/v1/session/".length), deliveryId: "delivery-1" },
      { status: 202 },
    );
  });
  return { services: github.layer, sent };
}

test("a queued question on a plan's conversation is accepted, and one that does not read is refused", async () => {
  const call = await callerOn(brainHost(seams), await planConversation());

  assert.deepEqual(await call(QUEUE_QUESTION_TOOL.name, QUESTION), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
  });
  const unreadable = await call(QUEUE_QUESTION_TOOL.name, { question: "" });
  assert.equal(unreadable.status, ACTION_RESULT_STATUS.REJECTED);
});

test("a name no planning turn is offered runs nothing and answers why", async () => {
  const call = await callerOn(brainHost(seams), await planConversation());

  const answer = await call(UNOFFERED_TOOL, { name: "USER.md", content: "x" });

  assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
  assert.ok(isWireString(answer.reason));
});

test("a conversation no plan names runs none of the planning tools, the question queue included", async () => {
  const userId = await database.createUser();
  const target = { userId, conversationId: await insertConversation(database.run, { userId }) };
  const call = await callerOn(brainHost(seams), target);

  const answer = await call(QUEUE_QUESTION_TOOL.name, QUESTION);

  assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
  assert.ok(isWireString(answer.reason));
});

test("a worker's session is recorded in its child conversation as a child turn, and the planning session keeps the conversation's record", async () => {
  const target = await planConversation();
  const host = brainHost(seams);
  const rootId = sessionId();
  const auth = seat(target);
  const starting = await database.run(host.admitStarting(auth, rootId));
  if (Result.isFailure(starting)) return assert.fail(starting.failure);
  assert.equal(await database.run(host.sessionStarted(starting.success, rootId)), true);

  const turn = { id: "turn_0", sequence: 0 };
  const child = {
    id: `${rootId}-child`,
    auth,
    turn,
    parent: { callId: "call-worker-1", rootSessionId: rootId, sessionId: rootId, turn },
  };
  const state = memoryRelayState();
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, NOW);
  for (const event of [
    stamped({ type: "turn.started", data: { turnId: "turn_0", sequence: 0 } }),
    stamped({
      type: "message.received",
      data: { turnId: "turn_0", sequence: 0, message: "Compare the queues." },
    }),
    stamped({
      type: "step.started",
      data: { turnId: "turn_0", sequence: 0, stepIndex: 0, modelId: "m" },
    }),
    stamped({
      type: "message.completed",
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 0,
        finishReason: "stop",
        message: "Queue A wins.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId: "turn_0", sequence: 0, stepIndex: 0, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId: "turn_0", sequence: 0 } }),
  ]) {
    await database.run(host.relayChild(event, child, state).pipe(Effect.provide(NO_GITHUB)));
  }

  const journals = await database.run(
    listJournals(
      target.userId,
      childConversationId(target.conversationId, "call-worker-1"),
      HOSTED_TOOL_SET,
      10,
    ),
  );
  assert.ok(journals.ok);
  assert.deepEqual(
    journals.value.flatMap((row) =>
      row.message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    ),
    ["Queue A wins."],
  );
  const [childTurn] = await database.run(
    database.store.turns.named(target.userId, [hostTurnId(child.id, "turn_0")]),
  );
  assert.equal(childTurn?.origin, TURN_ORIGIN.CHILD);
  // The planning session still stands for its conversation, so its own calls still run.
  assert.ok(Result.isSuccess(await database.run(host.admit(auth, rootId))));
});

test("the plan's coding agents are listed with their status, what each published, and what each last did; one is read as a bounded tail; and an agent is read only on its own plan", async () => {
  const plan = await planConversation(undefined, RELAY_FULL_NAME);
  const working = await agentOn(plan.userId, plan.planId);
  const starting = await agentOn(plan.userId, plan.planId);
  const commands = [
    `git switch -c ${BRANCH}`,
    ...Array.from({ length: CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES }, (_, index) => `ls ${index}`),
  ];
  await agentRan(working, commands, AGENT_WORDS);
  const call = await callerOn(brainHost(seams), plan);

  const listed = await call(LIST_CODING_AGENTS_TOOL.name, {});
  assert.equal(listed.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(listed.agents, [
    {
      id: working.id,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      status: CODING_AGENT_STATUS.RUNNING,
      repository: RELAY_FULL_NAME,
      branch: BRANCH,
      pullRequestNumber: null,
      activity: `Said: ${AGENT_WORDS}`,
    },
    {
      id: starting.id,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      status: CODING_AGENT_STATUS.STARTING,
      repository: RELAY_FULL_NAME,
      branch: null,
      pullRequestNumber: null,
      activity: null,
    },
  ]);

  const read = await call(READ_CODING_AGENT_TOOL.name, { agentId: working.id });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.ok(Array.isArray(read.tail));
  // The tail is the newest entries, the words last; the first command fell off its front.
  assert.equal(read.tail.length, CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES);
  assert.equal(read.tail[0], "Ran: ls 1");
  assert.equal(read.tail.at(-1), `Said: ${AGENT_WORDS}`);

  const otherPlan = await planConversation(plan.userId, RELAY_FULL_NAME);
  const elsewhere = await callerOn(brainHost(seams), otherPlan);
  assert.deepEqual(await elsewhere(READ_CODING_AGENT_TOOL.name, { agentId: working.id }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT,
  });
});

test("a message to the plan's agent steers its session as the deployment acting for the account, under the tool call's own key, and is sent once; another account's agent gets nothing, and a deployment with no secret sends nothing", async () => {
  const userId = await database.run(openGithubUser());
  const plan = await planConversation(userId, RELAY_FULL_NAME);
  const agent = await agentOn(userId, plan.planId);
  const eve = fakeCoderEve();
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, plan, eve.services);

  const sent = await call(MESSAGE_CODING_AGENT_TOOL.name, { agentId: agent.id, text: INSTRUCTION });
  assert.deepEqual(sent, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    delivery: STEER_OUTCOME.SENT,
    agent: { id: agent.id, status: CODING_AGENT_STATUS.RUNNING },
  });
  assert.equal(eve.sent.length, 1);
  const [request] = eve.sent;
  assert.equal(request?.path, `/eve/coder/v1/session/${agent.sessionId}`);
  assert.equal(request?.headers.get("authorization"), `Bearer ${CRON_SECRET}`);
  assert.equal(request?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), userId);
  assert.equal(request?.headers.get(BRAIN_HOST_HEADER.CONVERSATION), agent.conversationId);
  assert.equal(request?.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);
  assert.deepEqual(JSON.parse(request?.body ?? ""), { message: INSTRUCTION });
  // The line awaits its turn under the call's key, so the same call run again sends nothing more.
  assert.equal(
    await database.run(sentLineStands(userId, agent.conversationId, sentLineId("call-1"))),
    true,
  );
  const again = await call(MESSAGE_CODING_AGENT_TOOL.name, {
    agentId: agent.id,
    text: INSTRUCTION,
  });
  assert.equal(again.delivery, STEER_OUTCOME.REPEATED);
  assert.equal(eve.sent.length, 1);

  const stranger = await planConversation(undefined, RELAY_FULL_NAME);
  const strangersAgent = await agentOn(stranger.userId, stranger.planId);
  assert.deepEqual(
    await call(MESSAGE_CODING_AGENT_TOOL.name, { agentId: strangersAgent.id, text: INSTRUCTION }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT },
  );
  assert.equal(eve.sent.length, 1);

  const unsecured = await callerOn(brainHost(seams), plan, eve.services);
  assert.deepEqual(
    await unsecured(MESSAGE_CODING_AGENT_TOOL.name, { agentId: agent.id, text: INSTRUCTION }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.NO_SERVICE },
  );
  assert.equal(eve.sent.length, 1);
});
