import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import {
  ensureMember,
  ensureTaskChannel,
  openAsksOf,
  postAsk,
} from "@luke/database/models/chat-store";
import {
  archiveCodingAgent,
  createCodingAgent,
  lineSendersOf,
  readCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { hostTurnId, sentLineId } from "@luke/database/models/ids";
import { readMessageByClientId, sentLineStands } from "@luke/database/models/message-reads";
import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { writePage } from "@luke/database/models/plan-pages";
import {
  createTask,
  listTasks,
  openTaskConversation,
  readTask,
} from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { joinWorkspace, openHostedStoreTestDatabase, startTask } from "@luke/database/testing";
import { firstMessageParts, START_NOTE_HEADING } from "@luke/features/agent-replay";
import {
  ASK_STATUS,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_TOOL,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { PICTURE_TYPE } from "@luke/features/picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { EXPERIMENT } from "@luke/settings";
import { Effect, Fiber, Layer, Option, Redacted, Result } from "effect";
import { Base64 } from "effect/encoding";
import type * as HttpClient from "effect/http/HttpClient";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  isRecord,
  isWireString,
  sessionKey,
  TURN_ORIGIN,
  unparsedWire,
  type WireRecord,
} from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import { modelCatalogOf, type OfferedModel } from "../../providers/model-catalog.js";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { END_CALL_TOOL } from "../../tasks/end-call.js";
import {
  LOOK_AT_PICTURE_TOOL,
  PICTURE_LOOK_REFUSAL,
  pictureNotLooked,
} from "../../tasks/picture-look.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  NO_GITHUB,
} from "../../testing/github-app-fake.js";
import { CHAT_TOOL_REFUSAL } from "../coder-host/chat.js";
import { ASK_REFUSAL } from "../coder-host/chat-ask.js";
import { HELD_DOORS } from "../coder-host/chat-notify.js";
import { STEER_OUTCOME } from "../coder-host/steer.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import {
  ARCHIVE_AGENT_REFUSAL,
  ARCHIVE_AGENT_TOOL,
  ARCHIVE_TASK_REFUSAL,
  ARCHIVE_TASK_TOOL,
  CODING_AGENT_TOOL_REFUSAL,
  LIST_AGENTS_TOOL,
  LIST_TASKS_TOOL,
  MESSAGE_AGENT_TOOL,
  READ_AGENT_TOOL,
  READ_PAGE_TOOL,
  START_AGENT_TOOL,
  START_CODING_AGENT_REFUSAL,
  UNARCHIVE_TASK_TOOL,
} from "../coding-agent-tools.js";
import { AGENT_LIST_FILTER_REFUSAL } from "../workspace-agents.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "./bounds.js";
import { brainToolDeclarations, tasksModelOutput } from "./brain.js";
import { type BrainChatCall, ChatPostTally, lukeOn, runBrainPost } from "./chat.js";
import {
  claimRuntimeSession,
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "./conversation.js";
import { type BrainHost, brainHost } from "./host.js";
import type { BrainHostSeams } from "./production.js";

/**
 * The brain's tools as eve runs them through the host's `runTool`, over the
 * real migrations on PGlite: a call is carried under the task the admitted
 * conversation belongs to, and answers why it ran nothing, as a result the
 * model reads, for a name the turn was not offered, a conversation no task
 * names, or an input that does not read. Synthetic accounts and tasks
 * throughout.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** The installation ids handed out so far: one installation stands for one workspace, so each task's workspace connects its own. */
let installationsConnected = 0;
const CRON_SECRET = "cron-secret-1";
const EVE_ORIGIN = "https://luke.test";
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

/** Chat turned on for the account, as its Experimental page would. */
async function chatOn(userId: string): Promise<void> {
  await database.run(writeAccountPreferences(userId, { experiments: { [EXPERIMENT.CHAT]: true } }));
}

/** A task's own conversation, opened as the Tasks tab opens it, on the repository where one is named. */
async function taskConversation(
  userId?: string,
  repository?: string,
): Promise<ConversationTarget & { readonly taskId: string; readonly workspaceId: string }> {
  const owner = userId ?? (await database.createUser());
  const name = "Teammate invitations";
  const task = await database.run(
    startTask(owner, repository === undefined ? { name } : { name, repository }),
  );
  const conversationId = Option.getOrThrow(
    await database.run(openTaskConversation(owner, task.id)),
  ).conversationId;
  return { userId: owner, conversationId, taskId: task.id, workspaceId: task.workspaceId };
}

/** What sent the line standing under a send's key, as an agent's page names it; nothing where no line or no sender stands. */
const lineSenderUnder = (target: ConversationTarget, clientKey: string) =>
  Effect.gen(function* () {
    const read = yield* readMessageByClientId(
      target.userId,
      target.conversationId,
      {},
      sentLineId(clientKey),
    );
    const id = read.ok ? read.value[0]?.id : undefined;
    return id === undefined ? undefined : (yield* lineSendersOf(target, [id])).get(id);
  });

/** An agent started on the task, the session eve runs it in recorded on its conversation as the store hook records it. */
async function agentOn(
  userId: string,
  taskId: string,
): Promise<ConversationTarget & { readonly id: string; readonly sessionId: string }> {
  const started = Option.getOrThrow(
    await database.run(
      createCodingAgent(userId, {
        taskId,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        planSnapshot: "# Teammate invitations",
        prompt: null,
        repository: RELAY_FULL_NAME,
      }),
    ),
  );
  const target = { userId, conversationId: started.agent.conversationId };
  const session = sessionId();
  assert.equal(await database.run(claimRuntimeSession(target, session, new Date(NOW))), true);
  return { ...target, id: started.agent.id, sessionId: session };
}

/**
 * eve's coding-agent service as a script beside the fake GitHub, whose
 * installation reaching the repository is connected to the workspace given:
 * every opening answered with a session of its own, every message to a
 * session answered taken, and each written down.
 */
async function fakeCoderEve(workspaceId: string) {
  installationsConnected += 1;
  const installation: InstallationFixture = {
    id: 7 + installationsConnected,
    login: RELAY.owner,
    repositories: [RELAY],
  };
  assert.equal(
    await database.run(connectWorkspaceGitHub(workspaceId, installation)),
    LINK_OUTCOME.LINKED,
  );
  const sent: { readonly path: string; readonly headers: Headers; readonly body: string }[] = [];
  const github = githubReaching([installation], undefined, undefined, (request) => {
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

test("a message to the plan's agent steers its session as the deployment acting for the account, under the tool call's own key, and is sent once; another account's agent gets nothing, and a deployment with no secret sends nothing", async () => {
  const userId = await database.createUser();
  const task = await taskConversation(userId, RELAY_FULL_NAME);
  const agent = await agentOn(userId, task.taskId);
  const eve = await fakeCoderEve(task.workspaceId);
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, task, eve.services);

  const sent = await call(MESSAGE_AGENT_TOOL.name, { agentId: agent.id, text: INSTRUCTION });
  assert.deepEqual(sent, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    delivery: STEER_OUTCOME.SENT,
    agent: {
      id: agent.id,
      title: "anthropic/claude-opus-5.5",
      model: "anthropic/claude-opus-5.5",
      status: CODING_AGENT_STATUS.RUNNING,
      onYourTask: true,
    },
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
  // The agent's tab names Luke over it, the line being his rather than the member's on the call.
  assert.deepEqual(await database.run(lineSenderUnder(agent, "call-1")), {
    kind: MESSAGE_SENDER.LUKE,
  });
  const again = await call(MESSAGE_AGENT_TOOL.name, {
    agentId: agent.id,
    text: INSTRUCTION,
  });
  assert.equal(again.delivery, STEER_OUTCOME.REPEATED);
  assert.equal(eve.sent.length, 1);

  const stranger = await taskConversation(undefined, RELAY_FULL_NAME);
  const strangersAgent = await agentOn(stranger.userId, stranger.taskId);
  assert.deepEqual(
    await call(MESSAGE_AGENT_TOOL.name, { agentId: strangersAgent.id, text: INSTRUCTION }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT },
  );
  assert.equal(eve.sent.length, 1);

  const unsecured = await callerOn(brainHost(seams), task, eve.services);
  assert.deepEqual(
    await unsecured(MESSAGE_AGENT_TOOL.name, { agentId: agent.id, text: INSTRUCTION }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.NO_SERVICE },
  );
  assert.equal(eve.sent.length, 1);
});

test("a member speaking in the plan conversation a teammate opened messages the teammate's agent: eve is reached as the deployment acting for the member, on the starter's session, and the line stands under the starter", async () => {
  const opener = await database.createUser();
  const member = await database.createUser();
  const task = await taskConversation(opener, RELAY_FULL_NAME);
  await database.run(joinWorkspace(task.workspaceId, member));
  const agent = await agentOn(opener, task.taskId);
  const eve = await fakeCoderEve(task.workspaceId);
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, task, eve.services, [], member);

  const sent = await call(MESSAGE_AGENT_TOOL.name, { agentId: agent.id, text: INSTRUCTION });
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

test("Luke makes the new task a start names for the member speaking, in the call's task's workspace and on its repository, and starts on it; a call on a task naming no repository makes none", async () => {
  const opener = await database.createUser();
  const member = await database.createUser();
  const task = await taskConversation(opener, RELAY_FULL_NAME);
  await database.run(joinWorkspace(task.workspaceId, member));
  const eve = await fakeCoderEve(task.workspaceId);
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, task, eve.services, CATALOG, member);

  const started = await call(
    START_AGENT_TOOL.name,
    { newTask: "Expiry", prompt: TASK },
    "call-new",
  );
  const agent = startedAgentOf(started);
  assert.ok(isRecord(started.newTask) && isWireString(started.newTask.id), JSON.stringify(started));
  const made = Option.getOrThrow(await database.run(readTask(member, started.newTask.id)));
  assert.deepEqual(
    [made.ownerId, made.task.workspaceId, made.task.repository, made.task.name],
    [member, task.workspaceId, RELAY_FULL_NAME, "Expiry"],
  );
  const stored = Option.getOrThrow(await database.run(readCodingAgent(member, agent.id)));
  assert.equal(stored.taskId, made.task.id);
  assert.equal(eve.sent.length, 1);

  const bare = await taskConversation(opener);
  const onBare = await callerOn(acting, bare, eve.services, CATALOG);
  assert.deepEqual(
    await onBare(START_AGENT_TOOL.name, { newTask: "Nowhere", prompt: TASK }, "call-bare"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.NO_REPOSITORY },
  );
  const listed = await database.run(listTasks(opener));
  assert.equal(listed.filter((each) => each.name === "Nowhere").length, 0);
  assert.equal(eve.sent.length, 1);
});

test("Luke's agent tools reach every agent of the task's workspace: a list names each agent's task, narrowed to this task or another by its id, archived ones marked; another task's agent, a teammate's, is read and messaged; an archived agent takes no message, and another workspace's agent is none of these", async () => {
  const opener = await database.createUser();
  const teammate = await database.createUser();
  const task = await taskConversation(opener, RELAY_FULL_NAME);
  await database.run(joinWorkspace(task.workspaceId, teammate));
  const billing = await taskConversation(opener, RELAY_FULL_NAME);
  assert.equal(billing.workspaceId, task.workspaceId);
  const own = await agentOn(opener, task.taskId);
  const teammates = await agentOn(teammate, billing.taskId);
  const archived = await agentOn(opener, billing.taskId);
  await database.run(archiveCodingAgent(opener, archived.id, true));
  const stranger = await taskConversation(undefined, RELAY_FULL_NAME);
  const strangers = await agentOn(stranger.userId, stranger.taskId);
  const eve = await fakeCoderEve(task.workspaceId);
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, task, eve.services, CATALOG);
  const listedIds = async (input: WireRecord) => {
    const listed = await call(LIST_AGENTS_TOOL.name, input);
    assert.ok(Array.isArray(listed.agents), JSON.stringify(listed));
    return listed.agents.map((each) => (isRecord(each) ? each.id : undefined)).sort();
  };

  assert.deepEqual(await listedIds({}), [own.id, teammates.id, archived.id].sort());
  assert.deepEqual(await listedIds({ thisTask: true }), [own.id]);
  assert.deepEqual(await call(LIST_AGENTS_TOOL.name, { taskId: billing.taskId, thisTask: true }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: AGENT_LIST_FILTER_REFUSAL.BOTH,
  });
  assert.deepEqual(await listedIds({ taskId: billing.taskId }), [teammates.id, archived.id].sort());
  const listed = await call(LIST_AGENTS_TOOL.name, { taskId: billing.taskId });
  const archivedReading = Array.isArray(listed.agents)
    ? listed.agents.find((each) => isRecord(each) && each.id === archived.id)
    : undefined;
  assert.ok(isRecord(archivedReading));
  assert.deepEqual(archivedReading.task, {
    id: billing.taskId,
    name: "Teammate invitations",
    archived: false,
  });
  assert.equal(archivedReading.onYourTask, false);
  assert.equal(archivedReading.archived, true);

  const read = await call(READ_AGENT_TOOL.name, { agentId: teammates.id });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(read));
  assert.ok(isRecord(read.agent));
  assert.equal(read.agent.id, teammates.id);

  const sent = await call(MESSAGE_AGENT_TOOL.name, {
    agentId: teammates.id,
    text: INSTRUCTION,
  });
  assert.equal(sent.delivery, STEER_OUTCOME.SENT, JSON.stringify(sent));
  assert.equal(eve.sent[0]?.path, `/eve/coder/v1/session/${teammates.sessionId}`);
  assert.deepEqual(await database.run(lineSenderUnder(teammates, "call-1")), {
    kind: MESSAGE_SENDER.LUKE,
  });

  // Luke passes on the developer's words as they are, to a member's own bound and no less.
  const longest = "a".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS);
  const forwarded = await call(
    MESSAGE_AGENT_TOOL.name,
    { agentId: teammates.id, text: longest },
    "call-longest",
  );
  assert.equal(forwarded.delivery, STEER_OUTCOME.SENT, JSON.stringify(forwarded));
  assert.equal(JSON.parse(eve.sent[1]?.body ?? "").message, longest);

  assert.deepEqual(
    await call(MESSAGE_AGENT_TOOL.name, { agentId: archived.id, text: INSTRUCTION }, "call-2"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.AGENT_ARCHIVED },
  );
  assert.deepEqual(await call(READ_AGENT_TOOL.name, { agentId: strangers.id }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT,
  });
  assert.equal(eve.sent.length, 2);

  // Luke lists the workspace's tasks and starts an agent on another of them by its id.
  const tasks = await call(LIST_TASKS_TOOL.name, {});
  assert.ok(Array.isArray(tasks.tasks), JSON.stringify(tasks));
  assert.deepEqual(
    tasks.tasks.map((task) => (isRecord(task) ? task.id : undefined)).sort(),
    [task.taskId, billing.taskId].sort(),
  );
  const started = await call(START_AGENT_TOOL.name, { taskId: billing.taskId }, "call-start");
  const startedId = startedAgentOf(started).id;
  const stored = Option.getOrThrow(await database.run(readCodingAgent(opener, startedId)));
  assert.equal(stored.taskId, billing.taskId);
  assert.equal(eve.sent.length, 3);
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

test("Luke starts an agent on the call's plan as the deployment acting for the account: on the plan and the default choice with no prompt, on a prompt and the choice named, under the tool call's own key so the same call run again starts no second agent; a choice the catalog refuses is refused with the choices, and a deployment with no secret starts nothing", async () => {
  const userId = await database.createUser();
  const task = await taskConversation(userId, RELAY_FULL_NAME);
  const eve = await fakeCoderEve(task.workspaceId);
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, task, eve.services, CATALOG);

  const started = await call(START_AGENT_TOOL.name, {});
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
  assert.equal(stored.taskId, task.taskId);
  assert.equal(stored.prompt, null);
  // The session opened as the deployment for the account, on the agent's conversation, with the task first.
  assert.equal(eve.sent.length, 1);
  const [opening] = eve.sent;
  assert.equal(opening?.path, "/eve/coder/v1/session");
  assert.equal(opening?.headers.get("authorization"), `Bearer ${CRON_SECRET}`);
  assert.equal(opening?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), userId);
  assert.equal(opening?.headers.get(BRAIN_HOST_HEADER.CONVERSATION), stored.conversationId);
  assert.equal(opening?.headers.get(BRAIN_HOST_HEADER.TURN), BRAIN_HOST_TURN.TYPED);
  assert.match(JSON.parse(opening?.body ?? "").message, /^# Teammate invitations/u);

  // The same call run again is the same agent, and opens nothing again.
  const again = await call(START_AGENT_TOOL.name, {});
  assert.equal(startedAgentOf(again).id, agent.id);
  assert.equal(eve.sent.length, 1);

  const tasked = await call(
    START_AGENT_TOOL.name,
    { prompt: TASK, model: SOL, effort: "low" },
    "call-2",
  );
  assert.equal(tasked.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(tasked));
  const second = startedAgentOf(tasked);
  assert.deepEqual([second.model, second.effort], [SOL, "low"]);
  // Named as the catalog names it, as the screen does once the catalog is read.
  assert.equal(second.modelName, "GPT-6.1 Sol");
  assert.equal(JSON.parse(eve.sent[1]?.body ?? "").message, TASK);
  // The agents it started are the ones the other tools then read.
  const listed = await call(LIST_AGENTS_TOOL.name, {});
  assert.ok(Array.isArray(listed.agents));
  assert.deepEqual(
    listed.agents.map((each) => (isRecord(each) ? each.id : undefined)).sort(),
    [agent.id, second.id].sort(),
  );

  const refused = await call(START_AGENT_TOOL.name, { model: SOL, effort: "max" }, "call-3");
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.match(String(refused.reason), /openai\/gpt-6\.1-sol \(low, high\)/u);
  assert.match(String(refused.reason), /anthropic\/claude-opus-5\.5 \(low, medium, high, max\)/u);
  assert.deepEqual(await call(START_AGENT_TOOL.name, { model: SOL }, "call-4"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.UNREADABLE,
  });
  assert.equal(eve.sent.length, 2);

  // A call the model made under the tool's earlier words names its prompt `task`, and starts on it all the same.
  const earlier = await call(START_AGENT_TOOL.name, { task: "Draft the release notes." }, "call-6");
  assert.equal(earlier.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(earlier));
  assert.equal(JSON.parse(eve.sent[2]?.body ?? "").message, "Draft the release notes.");

  const unsecured = await callerOn(brainHost(seams), task, eve.services, CATALOG);
  assert.deepEqual(await unsecured(START_AGENT_TOOL.name, {}, "call-5"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.NO_SERVICE,
  });
  assert.equal(eve.sent.length, 3);
});

test("Luke's one start carries what the developer said beyond the plan: the note rides after the plan, or after a prompt, in the agent's one opening message, and the agent is still handed the plan", async () => {
  const userId = await database.createUser();
  const task = await taskConversation(userId, RELAY_FULL_NAME);
  const eve = await fakeCoderEve(task.workspaceId);
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, task, eve.services, CATALOG);

  const started = await call(START_AGENT_TOOL.name, { note: INSTRUCTION });
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  const agent = startedAgentOf(started);
  const stored = Option.getOrThrow(await database.run(readCodingAgent(userId, agent.id)));
  assert.equal(stored.prompt, null);
  assert.equal(eve.sent.length, 1);
  const opening: string = JSON.parse(eve.sent[0]?.body ?? "").message;
  const read = firstMessageParts(opening);
  assert.match(read.brief, /^# Teammate invitations/u);
  assert.deepEqual(read.note, {
    heading: START_NOTE_HEADING.DEVELOPER,
    text: INSTRUCTION,
    files: { text: 0, other: 0 },
  });

  const tasked = await call(START_AGENT_TOOL.name, { prompt: TASK, note: INSTRUCTION }, "call-2");
  assert.equal(tasked.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(tasked));
  assert.equal(eve.sent.length, 2);
  assert.deepEqual(firstMessageParts(JSON.parse(eve.sent[1]?.body ?? "").message), {
    brief: TASK,
    note: {
      heading: START_NOTE_HEADING.DEVELOPER,
      text: INSTRUCTION,
      files: { text: 0, other: 0 },
    },
  });

  // A note's mentions are handed as a message's are: an issue it links is named with its server.
  const issue = mentionMarkdown(
    {
      kind: MENTION_KIND.LINK,
      provider: INTEGRATION_PROVIDER.LINEAR,
      url: "https://linear.app/acme/issue/LUKE-142/fix-the-thing",
    },
    "LUKE-142/fix-the-thing",
    { workspace: "acme", repository: RELAY_FULL_NAME },
  );
  const linked = await call(START_AGENT_TOOL.name, { note: `Fix ${issue}.` }, "call-3");
  assert.equal(linked.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(linked));
  assert.equal(eve.sent.length, 3);
  const parts: unknown = JSON.parse(eve.sent[2]?.body ?? "").message;
  assert.ok(Array.isArray(parts), JSON.stringify(parts));
  const texts = parts.map((part) => (isRecord(part) && isWireString(part.text) ? part.text : ""));
  assert.match(firstMessageParts(texts[0] ?? "").note?.text ?? "", /^Fix /u);
  assert.match(texts[1] ?? "", /pointed you at https:\/\/linear\.app\/acme\/issue\/LUKE-142/u);
});

test("Luke looks at a picture of the call's plan as a member speaking in it: the model is shown the picture under its own type, and a picture of another plan is refused", async () => {
  const task = await taskConversation();
  const teammate = await database.createUser();
  await database.run(joinWorkspace(task.workspaceId, teammate));
  const elsewhere = await taskConversation(task.userId);
  const picture = {
    contentType: PICTURE_TYPE.JPEG,
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]),
  };
  const kept = await database.run(keepPlanAttachment(task.userId, task.taskId, picture));
  if (kept.status !== PLAN_ATTACHMENT_KEEP.KEPT) return assert.fail("no picture was kept");
  const address = planAttachmentAddress({ taskId: task.taskId, attachmentId: kept.id }, "acme");
  const call = await callerOn(brainHost(seams), task, NO_GITHUB, [], teammate);
  const callElsewhere = await callerOn(brainHost(seams), elsewhere);

  const looked = await call(LOOK_AT_PICTURE_TOOL.name, { address });
  const refused = await callElsewhere(LOOK_AT_PICTURE_TOOL.name, { address });

  assert.deepEqual(tasksModelOutput(LOOK_AT_PICTURE_TOOL.name, unparsedWire(looked)), {
    type: "content",
    value: [
      { type: "text", text: "The picture you asked to see:" },
      {
        type: "file",
        data: { type: "data", data: Base64.encode(picture.bytes) },
        mediaType: PICTURE_TYPE.JPEG,
      },
    ],
  });
  assert.deepEqual(refused, pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE));
});

test("end_call is the one planning tool eve is told ends its turn, so the model is asked for no step after the goodbye it was told to add nothing to", () => {
  const endings = brainToolDeclarations()
    .filter((tool) => tool.endsTurn === true)
    .map((tool) => tool.name);
  assert.deepEqual(endings, [END_CALL_TOOL.name]);
});

test("Luke archives an idle agent of the task's workspace, a teammate's, for the member on the call, recorded as Luke's with its reason, and refuses one still starting", async () => {
  const opener = await database.createUser();
  const teammate = await database.createUser();
  const task = await taskConversation(opener, RELAY_FULL_NAME);
  await database.run(joinWorkspace(task.workspaceId, teammate));
  const idle = await agentOn(teammate, task.taskId);
  const starting = await agentOn(teammate, task.taskId);
  // The idle agent's one turn ran and ended, as eve runs and ends one.
  const coderWriter = await database.run(storeWriter({ tools: CODER_TOOL_SET }));
  const turn = { conversationId: sessionKey(idle.conversationId), turnId: randomUUID() };
  await database.run(
    Effect.gen(function* () {
      yield* coderWriter.enqueueTurn(idle, {
        turnId: turn.turnId,
        origin: TURN_ORIGIN.TYPED,
        eveTurnId: "turn_0",
      });
      yield* coderWriter.consume(idle, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: 0,
      });
      yield* coderWriter.consume(idle, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        sequence: 2,
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        responseIds: [],
        at: 0,
      });
    }),
  );
  const eve = await fakeCoderEve(task.workspaceId);
  const call = await callerOn(brainHost(seams), task, eve.services, CATALOG);
  const reason = "The developer asked to clean up the finished agents.";

  const archived = await call(ARCHIVE_AGENT_TOOL.name, { agentId: idle.id, reason });
  assert.equal(archived.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(archived));
  const row = Option.getOrThrow(await database.run(readCodingAgent(opener, idle.id)));
  assert.ok(row.archivedAt !== null);
  assert.deepEqual(row.archivedBy, { by: CODING_AGENT_ARCHIVER.LUKE, userId: opener, reason });
  assert.deepEqual(await call(ARCHIVE_AGENT_TOOL.name, { agentId: starting.id }, "call-2"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ARCHIVE_AGENT_REFUSAL.WORKING,
  });
});

test("Luke archives a teammate's task of the call's workspace for the member on the call and brings it back, and refuses the call's own task and one of another workspace", async () => {
  const opener = await database.createUser();
  const teammate = await database.createUser();
  const task = await taskConversation(opener, RELAY_FULL_NAME);
  const stranger = await taskConversation(undefined, RELAY_FULL_NAME);
  await database.run(joinWorkspace(task.workspaceId, teammate));
  const done = await database.run(
    createTask(teammate, { organizationId: task.workspaceId, name: "Rollout step 3" }),
  );
  const eve = await fakeCoderEve(task.workspaceId);
  const call = await callerOn(brainHost(seams), task, eve.services, CATALOG);
  const archivedAt = async () =>
    Option.getOrThrow(await database.run(readTask(teammate, done.id))).task.archivedAt;
  const rejected = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });

  const archived = await call(ARCHIVE_TASK_TOOL.name, { taskId: done.id });
  assert.equal(archived.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(archived));
  assert.deepEqual([archived.archived, archived.already], [true, false]);
  assert.ok((await archivedAt()) !== undefined);
  const back = await call(UNARCHIVE_TASK_TOOL.name, { taskId: done.id }, "call-2");
  assert.deepEqual(
    [back.status, back.archived, back.already],
    [ACTION_RESULT_STATUS.ACCEPTED, false, false],
  );
  assert.equal(await archivedAt(), undefined);

  assert.deepEqual(
    await call(ARCHIVE_TASK_TOOL.name, { taskId: task.taskId }, "call-3"),
    rejected(ARCHIVE_TASK_REFUSAL.OWN_TASK),
  );
  assert.deepEqual(
    await call(ARCHIVE_TASK_TOOL.name, { taskId: stranger.taskId }, "call-4"),
    rejected(ARCHIVE_TASK_REFUSAL.NO_TASK),
  );
  assert.equal(
    Option.getOrThrow(await database.run(readTask(opener, task.taskId))).task.archivedAt,
    undefined,
  );
});

test("Luke reads a page of the call's task by its id, as the member on the call, and nothing of another workspace's", async () => {
  const opener = await database.createUser();
  const task = await taskConversation(opener, RELAY_FULL_NAME);
  const stranger = await taskConversation(undefined, RELAY_FULL_NAME);
  const shown = Option.getOrThrow(
    await database.run(
      writePage(
        opener,
        task.taskId,
        { title: "Funnel", html: "<h1>Funnel</h1>" },
        { kind: PAGE_SHOWER.LUKE },
      ),
    ),
  );
  const theirs = Option.getOrThrow(
    await database.run(
      writePage(
        stranger.userId,
        stranger.taskId,
        { title: "Theirs", html: "<p/>" },
        { kind: PAGE_SHOWER.LUKE },
      ),
    ),
  );
  const eve = await fakeCoderEve(task.workspaceId);
  const call = await callerOn(brainHost(seams), task, eve.services, CATALOG);

  const read = await call(READ_PAGE_TOOL.name, { pageId: shown.id });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(read));
  assert.ok(isRecord(read.page));
  assert.deepEqual([read.page.html, read.page.isYourTask], ["<h1>Funnel</h1>", true]);
  assert.equal(
    (await call(READ_PAGE_TOOL.name, { pageId: theirs.id })).status,
    ACTION_RESULT_STATUS.REJECTED,
  );
});

test("Luke's direct message to the plan's agent is told by a notice steered into its session as the deployment acting for the account, and a deployment that reaches no eve holds it for the agent's next read", async () => {
  const userId = await database.createUser();
  await chatOn(userId);
  const task = await taskConversation(userId, RELAY_FULL_NAME);
  const agent = await agentOn(userId, task.taskId);
  const eve = await fakeCoderEve(task.workspaceId);
  const acting = brainHost({
    ...seams,
    deploymentSecret: () => Redacted.make(CRON_SECRET),
    eveOrigin: () => EVE_ORIGIN,
  });
  const call = await callerOn(acting, task, eve.services);

  const told = await call(CHAT_TOOL.POST, { text: INSTRUCTION, to: "@agent-1" });
  assert.equal(told.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(told));
  assert.deepEqual([told.in, told.told, told.held], ["@agent-1", ["@agent-1"], []]);
  assert.deepEqual(
    eve.sent.map((request) => request.path),
    [`/eve/coder/v1/session/${agent.sessionId}`],
  );
  assert.equal(eve.sent[0]?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), userId);
  assert.match(JSON.parse(eve.sent[0]?.body ?? "").message, /@luke to you/u);

  // Another account's plan, on a deployment that reaches no eve: its agent reads Luke's word when it next reads.
  const other = await taskConversation(undefined, RELAY_FULL_NAME);
  await chatOn(other.userId);
  await agentOn(other.userId, other.taskId);
  const unsecured = await callerOn(brainHost(seams), other, eve.services);
  const held = await unsecured(CHAT_TOOL.POST, { text: INSTRUCTION, to: "@agent-1" });
  assert.equal(held.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(held));
  assert.deepEqual([held.told, held.held], [[], ["@agent-1"]]);
  assert.equal(eve.sent.length, 1);
});

test("with Chat off for the plan's owner Luke's chat tools run nothing, and once the owner turns it on they post", async () => {
  const task = await taskConversation();
  const call = await callerOn(brainHost(seams), task);

  const refused = await call(CHAT_TOOL.POST, { text: "Nobody hears this." }, "call-off");
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED, JSON.stringify(refused));
  assert.equal((await call(CHAT_TOOL.READ, {}, "read-off")).status, ACTION_RESULT_STATUS.REJECTED);

  await chatOn(task.userId);
  const posted = await call(CHAT_TOOL.POST, { text: "Now the room hears this." }, "call-on");
  assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(posted));
  const read = await call(CHAT_TOOL.READ, { channel: "#teammate-invitations" }, "read-on");
  assert.ok(Array.isArray(read.messages));
  assert.equal(read.messages.length, 1);
});

test("Luke speaks in the chat as the plan's own @luke whatever member a call's input names: a post naming an agent's member lands as Luke's, and an ask of the agent's cannot be resolved through Luke", async () => {
  const task = await taskConversation(undefined, RELAY_FULL_NAME);
  await chatOn(task.userId);
  const agent = await agentOn(task.userId, task.taskId);
  const channel = Option.getOrThrow(
    await database.run(ensureTaskChannel(task.userId, task.taskId)),
  );
  const { organizationId } = channel;
  const member = Option.getOrThrow(
    await database.run(
      ensureMember(task.userId, organizationId, { kind: MEMBER_KIND.AGENT, agentId: agent.id }),
    ),
  );
  const asked = await database.run(
    postAsk(task.userId, organizationId, {
      authorMemberId: member.id,
      to: { channelId: channel.id },
      blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Which queue sends the emails?" }],
      mentions: [],
      clientKey: randomUUID(),
      key: "invite-queue",
      ask: { response: { type: CHAT_ASK.TEXT } },
    }),
  );
  assert.ok(Result.isSuccess(asked));
  const call = await callerOn(brainHost(seams), task);
  const smuggled = { authorMemberId: member.id, as: "@agent-1", author: member.id };

  const posted = await call(CHAT_TOOL.POST, { text: "The outbox does.", ...smuggled }, "call-as");
  assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(posted));
  const read = await call(CHAT_TOOL.READ, { channel: "#teammate-invitations" }, "read-as");
  assert.ok(Array.isArray(read.messages));
  const mine = read.messages.find((each) => isRecord(each) && each.seq === posted.seq);
  assert.ok(isRecord(mine));
  assert.equal(mine.from, "@luke");

  assert.deepEqual(
    await call(CHAT_TOOL.RESOLVE, { key: "invite-queue", reason: "Answered.", ...smuggled }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: ASK_REFUSAL.NO_ASK },
  );
  const asks = await database.run(
    openAsksOf(task.userId, organizationId, { authorMemberId: member.id }, 5),
  );
  assert.deepEqual(
    asks.map((ask) => [ask.askKey, ask.askStatus]),
    [["invite-queue", ASK_STATUS.OPEN]],
  );
});

test("Luke posts at most the chat's bound in one turn, a call eve runs again is its one post however many came after, and a post the bound refused is no post", async () => {
  const task = await taskConversation();
  await chatOn(task.userId);
  const call = await callerOn(brainHost(seams), task);

  const first = await call(CHAT_TOOL.POST, { text: "Step 0 is done." }, "call-0");
  for (let at = 1; at < CHAT_BOUNDS.MAX_POSTS_PER_TURN; at += 1) {
    const posted = await call(CHAT_TOOL.POST, { text: `Step ${at} is done.` }, `call-${at}`);
    assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(posted));
  }
  const replayed = await call(CHAT_TOOL.POST, { text: "Step 0 is done." }, "call-0");
  assert.equal(replayed.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(replayed));
  assert.equal(replayed.seq, first.seq);
  assert.deepEqual(await call(CHAT_TOOL.POST, { text: "One more." }, "call-over"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CHAT_TOOL_REFUSAL.TOO_MANY_POSTS,
  });
  const read = await call(CHAT_TOOL.READ, { channel: "#teammate-invitations" });
  assert.ok(Array.isArray(read.messages));
  assert.equal(read.messages.length, CHAT_BOUNDS.MAX_POSTS_PER_TURN);
});

test("a post interrupted before it lands holds none of the turn's count", async () => {
  const task = await taskConversation();
  const tally = new ChatPostTally();
  let opened = false;
  const call: BrainChatCall = {
    luke: {
      ...lukeOn(task.userId, task.taskId),
      repository: null,
      telling: { eveFor: () => undefined, writer: Effect.succeed(writer), doors: HELD_DOORS },
    },
    clientKey: "call-a",
    turnId: "turn-1",
    tally,
    // A sandbox that never opens, so the post is under way once it is asked for.
    sandbox: () => {
      opened = true;
      return Promise.race([]);
    },
  };
  const picture = {
    text: "The new screen.",
    blocks: [{ type: "image", path: "shot.png", alt: "The screen." }],
  };

  await database.run(
    Effect.gen(function* () {
      const posting = yield* Effect.forkChild(runBrainPost(call, picture));
      while (!opened) yield* Effect.yieldNow;
      yield* Fiber.interrupt(posting);
    }).pipe(Effect.provide(NO_GITHUB)),
  );
  assert.equal(tally.reserve("turn-1", "call-b"), 0);
});

test("two runs of one call that land differently hold the turn's count while either posted, and let it go only once neither did", () => {
  const tally = new ChatPostTally();
  assert.equal(tally.reserve("turn-1", "call-a"), 0);
  assert.equal(tally.reserve("turn-1", "call-a"), 0);
  tally.settle("turn-1", "call-a", false);
  tally.settle("turn-1", "call-a", true);
  assert.equal(tally.reserve("turn-1", "call-b"), 1);
  tally.settle("turn-1", "call-b", false);
  assert.equal(tally.reserve("turn-1", "call-c"), 1);
  // Another turn counts on its own.
  assert.equal(tally.reserve("turn-2", "call-a"), 0);
});
