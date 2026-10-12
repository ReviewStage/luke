import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext, SessionContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  isRecord,
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
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "../server/hosted/brain-host/conversation";
import { type BrainHost, brainHost } from "../server/hosted/brain-host/host";
import { childConversationId, hostTurnId, sentLineId } from "../server/hosted/brain-host/ids";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { memoryRelayState } from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { childTitlesOf } from "../server/hosted/child-titles";
import { STEER_OUTCOME } from "../server/hosted/coder-host/steer";
import { CODER_TOOL, CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import {
  createCodingAgent,
  readCodingAgent,
  updateCodingAgentBranch,
} from "../server/hosted/coding-agent-store";
import {
  CODING_AGENT_TOOL_BOUNDS,
  CODING_AGENT_TOOL_REFUSAL,
  LIST_CODING_AGENTS_TOOL,
  MESSAGE_CODING_AGENT_TOOL,
  READ_CODING_AGENT_TOOL,
  START_CODING_AGENT_REFUSAL,
  START_CODING_AGENT_TOOL,
} from "../server/hosted/coding-agent-tools";
import { END_CALL_TOOL } from "../server/hosted/end-call";
import {
  CODING_AGENT_DEFAULT_CHOICE,
  modelCatalogOf,
  type OfferedModel,
} from "../server/hosted/model-catalog";
import { openPlanConversation } from "../server/hosted/plan-store";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { listJournals, sentLineStands } from "../server/hosted/store/message-reads";
import { stampedEveEvent } from "./support/eve-events";
import { githubReaching, NO_GITHUB, openGithubUser } from "./support/github-app-fake";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";
import { titleModelAnswering } from "./support/title-model";
import { joinWorkspace, startPlan } from "./support/workspaces";

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
const TASK = "Rename the invite email's subject to say who sent it.";
const SOL = "openai/gpt-6.1-sol";

/** The two models offered a start, each with the efforts it lists. */
const CATALOG: readonly OfferedModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  { id: SOL, name: "GPT-6.1 Sol", provider: MODEL_PROVIDER.OPENAI, efforts: ["low", "high"] },
];

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    reachesSession: (userId, sessionId) =>
      database.run(runtimeSessionReachableBy(userId, sessionId)),
    reachesConversation: (userId, conversationId) =>
      database.run(conversationReachableBy(userId, conversationId)),
  },
  openAi: () => undefined,
  deploymentSecret: () => undefined,
  eveOrigin: () => undefined,
  titleModel: () => undefined,
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

function toolContext(
  id: string,
  auth: SessionAuth,
  name: string,
  callId = "call-1",
): EveToolContext {
  return {
    session: { id, auth, turn: { id: "turn_0", sequence: 0 } },
    abortSignal: new AbortController().signal,
    callId,
    toolName: name,
    messages: [],
    getToken: unreached("getToken"),
    requireAuth: unreached("requireAuth"),
    getSandbox: unreached("getSandbox"),
  };
}

/** A tool caller over one session claimed on the conversation, as the store hook claims it at the session's start; the services and the catalog are what a call may reach, the speaker is the conversation's opener unless a teammate is named, and the call id is eve's for the call, `call-1` unless said. */
async function callerOn(
  host: BrainHost,
  target: ConversationTarget,
  services: Layer.Layer<GitHubApp | HttpClient.HttpClient> = NO_GITHUB,
  catalog: readonly OfferedModel[] = [],
  speaker?: string,
): Promise<(name: string, input: WireRecord, callId?: string) => Promise<WireRecord>> {
  const id = sessionId();
  const opened = seat(target);
  // A teammate speaks into the session the conversation's opener started, under its own principal.
  const auth =
    speaker === undefined
      ? opened
      : { current: seat({ ...target, userId: speaker }).current, initiator: opened.initiator };
  const starting = await database.run(host.admitStarting(opened, id));
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
  return (name, input, callId) =>
    database.run(
      host
        .runTool(name, binding, input, toolContext(id, auth, name, callId))
        .pipe(Effect.provide(Layer.merge(services, modelCatalogOf(catalog)))),
    );
}

/** A plan's own conversation, opened as the Plans tab opens it, on the repository where one is named. */
async function planConversation(
  userId?: string,
  repository?: string,
): Promise<ConversationTarget & { readonly planId: string; readonly workspaceId: string }> {
  const owner = userId ?? (await database.createUser());
  const name = "Teammate invitations";
  const plan = await database.run(
    startPlan(owner, repository === undefined ? { name } : { name, repository }),
  );
  const conversationId = Option.getOrThrow(
    await database.run(openPlanConversation(owner, plan.id)),
  ).conversationId;
  return { userId: owner, conversationId, planId: plan.id, workspaceId: plan.workspaceId };
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

/** eve's coding-agent service as a script beside the fake GitHub: every opening answered with a session of its own, every message to a session answered taken, and each written down. */
function fakeCoderEve() {
  const sent: { readonly path: string; readonly headers: Headers; readonly body: string }[] = [];
  const github = githubReaching([INSTALLATION], undefined, undefined, (request) => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/eve/coder/v1/session")) return undefined;
    sent.push({ path: pathname, headers: request.headers, body: request.body });
    if (pathname === "/eve/coder/v1/session") {
      return Response.json({ sessionId: sessionId() }, { status: 202 });
    }
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

test("a planning turn is offered end_call, which is accepted on a plan's conversation and refused when it does not read", async () => {
  const call = await callerOn(brainHost(seams), await planConversation());

  assert.deepEqual(await call(END_CALL_TOOL.name, {}), { status: ACTION_RESULT_STATUS.ACCEPTED });
  // SAFETY: a model may emit any JSON as a call's input; a string stands for one that is no object.
  const unreadable = await call(END_CALL_TOOL.name, "bye" as unknown as WireRecord);
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

test("a worker is titled from the first task it received, even where a later task's arrival is what asks, on the child conversation of the call that started it, once; a title call that fails, or a deployment with no title model, leaves a worker untitled", async () => {
  const target = await planConversation();
  const model = titleModelAnswering(['"Queue comparison."', "Second title"]);
  const titling = brainHost({ ...seams, titleModel: () => model });
  const failing = brainHost({
    ...seams,
    titleModel: () => titleModelAnswering([new Error("fixture: provider down")]),
  });
  const untitled = brainHost(seams);
  const rootId = sessionId();
  const auth = seat(target);
  const starting = await database.run(titling.admitStarting(auth, rootId));
  if (Result.isFailure(starting)) return assert.fail(starting.failure);
  assert.equal(await database.run(titling.sessionStarted(starting.success, rootId)), true);

  const turn = { id: "turn_0", sequence: 0 };
  /** One task a worker's session receives, relayed as a turn of its own opening on it, under the state the relay keeps for that turn. */
  const received = async (child: SessionContext["session"], turnId: string, task: string) => {
    const state = memoryRelayState();
    for (const event of [
      stampedEveEvent({ type: "turn.started", data: { turnId, sequence: 0 } }, NOW),
      stampedEveEvent(
        { type: "message.received", data: { turnId, sequence: 0, message: task } },
        NOW,
      ),
    ]) {
      await database.run(titling.relayChild(event, child, state).pipe(Effect.provide(NO_GITHUB)));
    }
  };
  /** A worker's session under the call named, having received its first task. */
  const workerOf = async (callId: string, task: string) => {
    const child = {
      id: `${rootId}-${callId}`,
      auth,
      turn,
      parent: { callId, rootSessionId: rootId, sessionId: rootId, turn },
    };
    await received(child, "turn_0", task);
    return child;
  };
  const titlesOf = (callIds: readonly string[]) =>
    database.run(
      childTitlesOf(
        target,
        callIds.map((callId) => childConversationId(target.conversationId, callId)),
      ),
    );

  const worker = await workerOf("call-worker-1", "Compare the two queues' retry policies.");
  // A second task lands before any title does, and its arrival is what asks for the title.
  await received(worker, "turn_1", "Now compare their dead-letter queues.");
  await database.run(titling.titleChild(worker));
  const [asked] = model.doGenerateCalls;
  assert.ok(asked !== undefined);
  assert.match(JSON.stringify(asked.prompt), /Compare the two queues' retry policies/u);
  assert.doesNotMatch(JSON.stringify(asked.prompt), /dead-letter/u);
  // A worker already titled asks for no second title.
  await database.run(titling.titleChild(worker));
  assert.equal(model.doGenerateCalls.length, 1);

  await database.run(failing.titleChild(await workerOf("call-worker-2", "Read the queue docs.")));
  await database.run(untitled.titleChild(await workerOf("call-worker-3", "Read the queue docs.")));
  assert.deepEqual(
    [...(await titlesOf(["call-worker-1", "call-worker-2", "call-worker-3"])).values()],
    ["Queue comparison"],
  );
});

test("the plan's coding agents are listed with their status, what each published, and what each last did; one is read as a bounded tail; and an agent is read only on its own plan", async () => {
  const plan = await planConversation(undefined, RELAY_FULL_NAME);
  const working = await agentOn(plan.userId, plan.planId);
  const starting = await agentOn(plan.userId, plan.planId);
  const commands = Array.from(
    { length: CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES + 1 },
    (_, index) => `ls ${index}`,
  );
  await agentRan(working, commands, AGENT_WORDS);
  // The branch is the row's, written as a turn ends in the sandbox.
  await database.run(updateCodingAgentBranch(working.userId, working.id, BRANCH));
  const call = await callerOn(brainHost(seams), plan);

  const listed = await call(LIST_CODING_AGENTS_TOOL.name, {});
  assert.equal(listed.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(listed.agents, [
    {
      id: working.id,
      title: "anthropic/claude-opus-5.5",
      model: "anthropic/claude-opus-5.5",
      modelName: "Opus 5.5",
      effort: "high",
      status: CODING_AGENT_STATUS.RUNNING,
      repository: RELAY_FULL_NAME,
      branch: BRANCH,
      activity: `Said: ${AGENT_WORDS}`,
    },
    {
      id: starting.id,
      title: "anthropic/claude-opus-5.5",
      model: "anthropic/claude-opus-5.5",
      modelName: "Opus 5.5",
      effort: "high",
      status: CODING_AGENT_STATUS.STARTING,
      repository: RELAY_FULL_NAME,
      branch: null,
      activity: null,
    },
  ]);

  const read = await call(READ_CODING_AGENT_TOOL.name, { agentId: working.id });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.ok(Array.isArray(read.tail));
  // The tail is the newest entries, the words last; the first two commands fell off its front.
  assert.equal(read.tail.length, CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES);
  assert.equal(read.tail[0], "Ran: ls 2");
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

test("a member speaking in the plan conversation a teammate opened messages the teammate's agent: eve is reached as the deployment acting for the member, on the starter's session, and the line stands under the starter", async () => {
  const opener = await database.run(openGithubUser());
  const member = await database.run(openGithubUser());
  const plan = await planConversation(opener, RELAY_FULL_NAME);
  await database.run(joinWorkspace(plan.workspaceId, member));
  const agent = await agentOn(opener, plan.planId);
  const eve = fakeCoderEve();
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, plan, eve.services, [], member);

  const sent = await call(MESSAGE_CODING_AGENT_TOOL.name, { agentId: agent.id, text: INSTRUCTION });
  assert.equal(sent.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(sent));
  assert.equal(sent.delivery, STEER_OUTCOME.SENT);
  assert.equal(eve.sent.length, 1);
  const [request] = eve.sent;
  assert.equal(request?.path, `/eve/coder/v1/session/${agent.sessionId}`);
  assert.equal(request?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), member);
  assert.equal(request?.headers.get(BRAIN_HOST_HEADER.CONVERSATION), agent.conversationId);
  assert.equal(
    await database.run(sentLineStands(opener, agent.conversationId, sentLineId("call-1"))),
    true,
  );
});

/** The agent a start answered, as the model reads it; the test fails where the answer carries none. */
function startedAgentOf(answer: WireRecord) {
  const agent = answer.agent;
  assert.ok(isRecord(agent), JSON.stringify(answer));
  const { id, model, modelName, effort, status } = agent;
  assert.ok(
    isWireString(id) &&
      isWireString(model) &&
      isWireString(modelName) &&
      isWireString(effort) &&
      isWireString(status),
  );
  return { id, model, modelName, effort, status };
}

test("Luke starts an agent on the call's plan as the deployment acting for the account: on the plan and the default choice with no task, on a task and the choice named, under the tool call's own key so the same call run again starts no second agent; a choice the catalog refuses is refused with the choices, and a deployment with no secret starts nothing", async () => {
  const userId = await database.run(openGithubUser());
  const plan = await planConversation(userId, RELAY_FULL_NAME);
  const eve = fakeCoderEve();
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, plan, eve.services, CATALOG);

  const started = await call(START_CODING_AGENT_TOOL.name, {});
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  const agent = startedAgentOf(started);
  assert.deepEqual(agent, {
    id: agent.id,
    model: CODING_AGENT_DEFAULT_CHOICE.model,
    // The name Luke says aloud, as the screen shows it: without the maker's word.
    modelName: "Opus 5.5",
    effort: CODING_AGENT_DEFAULT_CHOICE.effort,
    status: CODING_AGENT_STATUS.STARTING,
  });
  const stored = Option.getOrThrow(await database.run(readCodingAgent(userId, agent.id)));
  assert.equal(stored.planId, plan.planId);
  assert.equal(stored.task, null);
  // The session opened as the deployment for the account, on the agent's conversation, with the plan first.
  assert.equal(eve.sent.length, 1);
  const [opening] = eve.sent;
  assert.equal(opening?.path, "/eve/coder/v1/session");
  assert.equal(opening?.headers.get("authorization"), `Bearer ${CRON_SECRET}`);
  assert.equal(opening?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), userId);
  assert.equal(opening?.headers.get(BRAIN_HOST_HEADER.CONVERSATION), stored.conversationId);
  assert.equal(opening?.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);
  assert.match(JSON.parse(opening?.body ?? "").message, /^# Teammate invitations/u);

  // The same call run again is the same agent, and opens nothing again.
  const again = await call(START_CODING_AGENT_TOOL.name, {});
  assert.equal(startedAgentOf(again).id, agent.id);
  assert.equal(eve.sent.length, 1);

  const tasked = await call(
    START_CODING_AGENT_TOOL.name,
    { task: TASK, model: SOL, effort: "low" },
    "call-2",
  );
  assert.equal(tasked.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(tasked));
  const second = startedAgentOf(tasked);
  assert.deepEqual([second.model, second.effort], [SOL, "low"]);
  // Named as the catalog names it, as the screen does once the catalog is read.
  assert.equal(second.modelName, "GPT-6.1 Sol");
  assert.equal(JSON.parse(eve.sent[1]?.body ?? "").message, TASK);
  // The agents it started are the ones the other tools then read.
  const listed = await call(LIST_CODING_AGENTS_TOOL.name, {});
  assert.ok(Array.isArray(listed.agents));
  assert.deepEqual(
    listed.agents.map((each) => (isRecord(each) ? each.id : undefined)),
    [agent.id, second.id],
  );

  const refused = await call(START_CODING_AGENT_TOOL.name, { model: SOL, effort: "max" }, "call-3");
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.match(String(refused.reason), /openai\/gpt-6\.1-sol \(low, high\)/u);
  assert.match(String(refused.reason), /anthropic\/claude-opus-5\.5 \(low, medium, high, max\)/u);
  assert.deepEqual(await call(START_CODING_AGENT_TOOL.name, { model: SOL }, "call-4"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.UNREADABLE,
  });
  assert.equal(eve.sent.length, 2);

  const unsecured = await callerOn(brainHost(seams), plan, eve.services, CATALOG);
  assert.deepEqual(await unsecured(START_CODING_AGENT_TOOL.name, {}, "call-5"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.NO_SERVICE,
  });
  assert.equal(eve.sent.length, 2);
});
