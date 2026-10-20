import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { sweepAbandonedTurns, TURN_ABANDON } from "@luke/database/models/abandoned-turns";
import { readAccountPreferences } from "@luke/database/models/account-store";
import {
  archiveCodingAgent,
  createCodingAgent,
  fillCodingAgentTitle,
  lineSendersOf,
  readCodingAgent,
  takeCodingAgentMentionedServers,
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import { readMessageByClientId, sentLineStands } from "@luke/database/models/message-reads";
import { writePage } from "@luke/database/models/plan-pages";
import { listRevisions } from "@luke/database/models/plan-revisions";
import { listTaskSections, writeTaskSections } from "@luke/database/models/task-section-store";
import {
  createTask,
  listTasks,
  readTask,
  savePlanText,
  updateTask,
} from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { task } from "@luke/database/schemas/task";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  joinWorkspace,
  leaveWorkspace,
  linearIssueLink,
  openHostedStoreTestDatabase,
  openWorkspace,
  startTask,
} from "@luke/database/testing";
import { START_NOTE_HEADING } from "@luke/features/agent-replay";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { FAST_ACCESS } from "@luke/features/provider-key-wire";
import { TASK_ISSUE_PROVIDER, TASK_ISSUE_RELATION } from "@luke/features/task-issue-wire";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
import { TASK_BOUNDS, TASK_PRIORITY, TASK_STATUS } from "@luke/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  AssistantMessageBuilder,
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  isRecord,
  isWireString,
  sessionKey,
  TOOL_CALL_SETTLEMENT,
  TURN_ORIGIN,
  type WireRecord,
} from "../../core.js";
import { recordingProductAnalytics, SERVER_EVENT } from "../../events/server-events.js";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import type { WorkspaceLinearConnect } from "../../integrations/integration-connect.js";
import {
  ModelCatalog,
  ModelCatalogUnavailable,
  modelCatalogOf,
  type OfferedModel,
} from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
} from "../../testing/github-app-fake.js";
import { integrationConnectOver, NO_WORKSPACE_LINEAR } from "../../testing/integration-connect.js";
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import { DEPLOYMENT_PRESENCE } from "../brain-host/auth.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { claimRuntimeSession } from "../brain-host/conversation.js";
import {
  CODING_AGENT_TOOL_REFUSAL,
  LIST_MODELS_REFUSAL,
  READ_PAGE_REFUSAL,
  START_CODING_AGENT_REFUSAL,
  STOP_AGENT_REFUSAL,
  UPDATE_AGENT_REFUSAL,
  UPDATE_TASK_REFUSAL,
} from "../coding-agent-tools.js";
import { TASK_ISSUE_REFUSAL } from "../task-issue-tools.js";
import { TASK_SECTION_TOOL_REFUSAL } from "../task-section-tools.js";
import { CREATE_TASK_REFUSAL, READ_TASK_REFUSAL } from "../task-tools.js";
import { AGENT_LIST_FILTER_REFUSAL } from "../workspace-agents.js";
import { CODER_REFUSAL } from "./bounds.js";
import { CODER_DEPLOYMENT_TURNS, coderChannelInput } from "./channel.js";
import { type AgentToolCall, type CoderHost, coderHost } from "./host.js";
import type { CoderHostSeams } from "./production.js";
import type { SummaryModelOf } from "./replay-summary.js";
import { STEER_OUTCOME } from "./steer.js";
import { CODER_TOOL, CODER_TOOL_SET } from "./tool-set.js";

/**
 * A coding agent's tools about the other agents of its workspace, through
 * the coding-agent host as the agent's own session calls them, over the real
 * migrations on PGlite and eve's coding-agent service faked at its HTTP
 * door: a list names every other agent of the caller's workspace, on any
 * plan and by any member, archived ones marked, and none of another
 * workspace's; a message reaches another member's agent on another plan as
 * the deployment acting for the caller's starter, once under the call's
 * key, opening with who sent it and kept under the sending agent's name; an
 * archived agent, an agent of another workspace, and the caller itself take
 * nothing, and a deployment with no secret sends nothing. An archive takes an
 * idle agent of the workspace, a teammate's among them, for the caller's
 * starter, recording the caller and its reason, once, and an unarchive
 * brings it back; a working agent, the caller itself, and an agent of
 * another workspace are not archived. A stop takes a teammate's running
 * agent's turn by the Stop button's own cancel, once, and the list then reads
 * it cancelled; an idle agent is answered as idle, and the caller itself, an
 * archived agent, and an agent of another workspace are not stopped.
 * Synthetic accounts, plans, and words throughout.
 */

const NOW = 1_800_000_000_000;
const CRON_SECRET = "cron-secret-1";
const EVE_ORIGIN = "https://luke.test";
const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
/** What every agent the suite starts runs on and works in. */
const AGENT_CHOICE = {
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  repository: RELAY_FULL_NAME,
} as const;
const NOTE = "I renamed InviteToken to InvitationToken on main; rebase before you push.";
const CALLER_TITLE = "Invite expiry";
const OPUS = "anthropic/claude-opus-5.5";
const OPUS_FAST = "anthropic/claude-opus-5.5-fast";
const SOL = "openai/gpt-6.1-sol";
/** A model with a small window, which a long replay does not fit whole. */
const SMALL_WINDOW = { model: "anthropic/claude-sonnet-4.9", tokens: 60_000 } as const;
/** The model the agents run on, as the catalog offers it. */
/** What the agents' tools counted, across the file; a test reads its own account's, from where it began. */
const ANALYTICS = recordingProductAnalytics();

/** How many tasks the account was counted as making. */
const tasksCounted = (userId: string) =>
  ANALYTICS.recorded.filter(
    (event) => event.userId === userId && event.name === SERVER_EVENT.TASK_CREATE,
  ).length;

const CATALOG: readonly OfferedModel[] = [
  {
    id: OPUS,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
];
/** The branch of the repository a stacked agent starts on, and the commit GitHub says it stands at. */
const STACKED_BRANCH = "luke/invitation-expiry";
const BRANCH_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";
/** The most characters of its own an agent's message may carry: a member's bound less its heading's room. */
const LONGEST_PEER_WORDS = CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS - 1_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: CODER_TOOL_SET }));

let minted = 0;
let installations = 0;

function sessionId(): string {
  minted += 1;
  return `wrun_01P${String(minted).padStart(22, "0")}`;
}

/** The host over the suite's store, acting at eve's door as the deployment where `acting` says, its summaries written on the model given. */
function hostOf(acting: boolean, summaryModel?: SummaryModelOf): CoderHost {
  const seams: CoderHostSeams = {
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      reachesSession: () => Promise.resolve(false),
      reachesConversation: () => Promise.resolve(false),
    },
    deploymentSecret: () => (acting ? Redacted.make(CRON_SECRET) : undefined),
    eveOrigin: () => (acting ? EVE_ORIGIN : undefined),
    keys: () => Effect.succeed({ anthropic: undefined, openAi: undefined }),
    fastRefused: async () => undefined,
    titleModel: () => undefined,
    research: () => ({ openAi: undefined, spend: Effect.void }),
    scriptedModel: () => true,
    ...(summaryModel === undefined ? undefined : { summaryModel }),
    now: () => NOW,
  };
  return coderHost(seams);
}

/** The auth an agent's own session runs under: its starter's, on its conversation. */
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

interface StartedAgent extends ConversationTarget {
  readonly id: string;
  readonly sessionId: string;
}

/** An agent started by the account on the plan, its eve session recorded as the store hook records it. */
async function agentOn(userId: string, taskId: string): Promise<StartedAgent> {
  return claimed(userId, {
    ...AGENT_CHOICE,
    idempotencyKey: randomUUID(),
    taskId: taskId,
    planSnapshot: "# Teammate invitations",
    prompt: null,
  });
}

/** An agent started by the account in the workspace on no task, as an automation's run starts one, its session recorded. */
async function tasklessAgentOn(userId: string, workspaceId: string): Promise<StartedAgent> {
  return claimed(userId, {
    ...AGENT_CHOICE,
    idempotencyKey: randomUUID(),
    taskId: null,
    organizationId: workspaceId,
    planSnapshot: null,
    prompt: "Sweep the flaky tests.",
  });
}

/** The agent the start made, its eve session recorded as the store hook records it. */
async function claimed(
  userId: string,
  start: Parameters<typeof createCodingAgent>[1],
): Promise<StartedAgent> {
  const started = await database.run(createCodingAgent(userId, start));
  assert.ok(Option.isSome(started));
  const target = { userId, conversationId: started.value.agent.conversationId };
  const session = sessionId();
  assert.equal(await database.run(claimRuntimeSession(target, session, new Date(NOW))), true);
  return { ...target, id: started.value.agent.id, sessionId: session };
}

/**
 * eve's coding-agent service as a script beside the fake GitHub, whose
 * installation reaching the repository is connected to the workspace:
 * every message to a session answered taken, or refused as a session eve
 * no longer runs where `retired` says or once `retire` is called, every
 * cancel answered as `cancelStatus` says, and each written down.
 */
async function fakeCoderEve(
  workspaceId: string,
  branches: readonly string[] = [],
  beforeGitHub?: () => Promise<void>,
  cancelStatus = "accepted",
  retiredFromStart = false,
) {
  let retired = retiredFromStart;
  installations += 1;
  const installation: InstallationFixture = {
    id: 70 + installations,
    login: RELAY.owner,
    repositories: [RELAY],
  };
  assert.equal(
    await database.run(connectWorkspaceGitHub(workspaceId, installation)),
    LINK_OUTCOME.LINKED,
  );
  const sent: { readonly path: string; readonly headers: Headers; readonly body: string }[] = [];
  const github = githubReaching([installation], undefined, undefined, async (request) => {
    const { pathname } = new URL(request.url);
    // The repository holds the branches given, each at a commit; any other is GitHub's not found.
    const ref = pathname.slice(`/repos/${RELAY_FULL_NAME}/git/ref/heads/`.length);
    if (pathname.startsWith(`/repos/${RELAY_FULL_NAME}/git/ref/heads/`) && branches.includes(ref)) {
      return Response.json({ object: { type: "commit", sha: BRANCH_COMMIT } });
    }
    if (!pathname.startsWith("/eve/coder/v1/session")) {
      if (beforeGitHub !== undefined) await beforeGitHub();
      return undefined;
    }
    sent.push({ path: pathname, headers: request.headers, body: request.body });
    if (pathname === "/eve/coder/v1/session") {
      return Response.json({ sessionId: sessionId() }, { status: 202 });
    }
    if (pathname.endsWith("/cancel")) return Response.json({ status: cancelStatus });
    if (retired) {
      return Response.json(
        { code: "session_not_active", error: "The session is no longer active.", ok: false },
        { status: 409 },
      );
    }
    return Response.json(
      { sessionId: pathname.slice("/eve/coder/v1/session/".length), deliveryId: "delivery-1" },
      { status: 202 },
    );
  });
  return {
    services: github.layer,
    sent,
    retire: () => {
      retired = true;
    },
  };
}

/** The workspace's Linear, connected, as a suite's Connect grants it. */
const LINEAR_CONNECTED = integrationConnectOver({
  LINEAR_CONNECTOR_UID: "mcp.linear.app/linear",
  LINEAR_WORKSPACE_CONNECTOR_UID: "linear/luke-workspaces",
}).pipe(Layer.orDie);

/** Linear's ENG-42, as its GraphQL API answers it to a link and to a read of its state. */
const LINEAR_ISSUE = {
  id: "5b6c1f0e-2a7d-4c3e-9f1a-0d8e7b6a5c4d",
  identifier: "ENG-42",
  title: "Invitations expire too soon",
  url: "https://linear.app/acme/issue/ENG-42/invitations-expire-too-soon",
  description: "Make them last a week.",
  state: { name: "In Progress" },
  assignee: null,
};

/**
 * GitHub with the workspace's installation granting the App issues on
 * Relay, whose issues 7 and 8 it answers, and Linear's GraphQL API on the
 * same network double answering ENG-42, with the workspace's Linear
 * connected; every other issue GitHub's not found.
 */
async function issueReadingGitHub(workspaceId: string) {
  installations += 1;
  const installation: InstallationFixture = {
    id: 70 + installations,
    login: RELAY.owner,
    repositories: [RELAY],
    permissions: {
      contents: "write",
      metadata: "read",
      pull_requests: "write",
      issues: "write",
    },
  };
  assert.equal(
    await database.run(connectWorkspaceGitHub(workspaceId, installation)),
    LINK_OUTCOME.LINKED,
  );
  await database.run(
    Database.use((db) =>
      db.insert(workspaceIntegrationConnection).values({
        organizationId: workspaceId,
        provider: INTEGRATION_PROVIDER.LINEAR,
        status: INTEGRATION_ROW_STATUS.CONNECTED,
      }),
    ),
  );
  const github = githubReaching([installation], undefined, undefined, (request) => {
    if (request.url === "https://api.linear.app/graphql") {
      return Response.json({ data: { issue: LINEAR_ISSUE } });
    }
    const numbered = new RegExp(`^/repos/${RELAY_FULL_NAME}/issues/(7|8)$`, "u").exec(
      new URL(request.url).pathname,
    );
    if (numbered === null) return undefined;
    const number = Number(numbered[1]);
    return Response.json({
      node_id: `I_kwDOrelay${number}`,
      number,
      title: `Relay issue ${number}`,
      html_url: `https://github.com/${RELAY_FULL_NAME}/issues/${number}`,
      state: "open",
      body: "",
      user: { login: "octo-dev" },
      author_association: "MEMBER",
      updated_at: "2026-10-01T00:00:00Z",
    });
  });
  return github.layer;
}

/** A caller of the agent tools from the agent's own session, under the host given, over the suite's catalog unless another is given. */
async function peerCaller(
  host: CoderHost,
  agent: StartedAgent,
  services: Awaited<ReturnType<typeof fakeCoderEve>>["services"],
  catalog: Layer.Layer<ModelCatalog> = modelCatalogOf(CATALOG),
  linear: Layer.Layer<WorkspaceLinearConnect> = NO_WORKSPACE_LINEAR,
) {
  const admitted = await database.run(host.admit(seat(agent), agent.sessionId));
  if (Result.isFailure(admitted)) return assert.fail(admitted.failure);
  return (
    tool: AgentToolCall["tool"],
    input: WireBoundaryInput,
    callId = "call-1",
  ): Promise<WireRecord> =>
    database.run(
      host
        .agentTools(admitted.success, { tool, input: unparsedWire(input), callId })
        .pipe(Effect.provide(Layer.mergeAll(services, catalog, ANALYTICS.layer, linear))),
    );
}

/** A turn of the agent's, begun as eve begins one and ended where `ended` says, so the agent reads as working or as idle; answers the turn's id. */
async function turnOn(agent: StartedAgent, ended: boolean): Promise<string> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const turnId = randomUUID();
  const turn = { conversationId: sessionKey(target.conversationId), turnId };
  await database.run(
    Effect.gen(function* () {
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: NOW,
      });
      if (!ended) return;
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        sequence: 2,
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        responseIds: [],
        at: NOW,
      });
    }),
  );
  return turnId;
}

/** The agent's turn ended as eve ends one it cancelled. */
async function cancelledTurnEnds(agent: StartedAgent, turnId: string): Promise<void> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  await database.run(
    writer.consume(target, {
      conversationId: sessionKey(target.conversationId),
      turnId,
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status: BRAIN_REQUEST_STATUS.CANCELLED,
      responseIds: [],
      at: NOW,
    }),
  );
}

/** What sent the line standing under a send's key in the agent's conversation, as its page names it. */
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

/** A turn of the agent's that ended on the answer given, journaled as the relay journals one. */
async function answeredTurnOn(agent: StartedAgent, answer: AssistantMessageBuilder): Promise<void> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const turnId = randomUUID();
  const turn = { conversationId: sessionKey(target.conversationId), turnId };
  await database.run(
    Effect.gen(function* () {
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: NOW,
      });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        sequence: 2,
        message: answer.finish(randomUUID()),
      });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        sequence: 3,
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        responseIds: [],
        at: NOW,
      });
    }),
  );
}

/** The tail a read answered, each entry as the record it is. */
function tailOf(read: WireRecord): readonly WireRecord[] {
  assert.ok(Array.isArray(read.tail), JSON.stringify(read));
  return read.tail.map((entry) => (isRecord(entry) ? entry : assert.fail(JSON.stringify(entry))));
}

/** What each entry of a read's tail says. */
function tailTexts(read: WireRecord): readonly unknown[] {
  return tailOf(read).map((entry) => entry.text);
}

/** The message each entry of a read's tail stands in. */
function tailMessageIds(read: WireRecord): readonly string[] {
  return tailOf(read).map((entry) =>
    isWireString(entry.messageId) ? entry.messageId : assert.fail(JSON.stringify(entry)),
  );
}

/**
 * One workspace with the caller's agent on one plan, a teammate's agent on
 * another plan, and an archived agent; a second workspace the caller's
 * starter is also in, with an agent of its own; and a stranger's workspace.
 */
async function openWorkspaces() {
  const alice = await database.createUser();
  const bob = await database.createUser();
  const carol = await database.createUser();
  const invitations = await database.run(
    startTask(alice, { name: "Teammate invitations", repository: RELAY_FULL_NAME }),
  );
  const workspaceId = invitations.workspaceId;
  await database.run(joinWorkspace(workspaceId, bob));
  const billing = await database.run(
    createTask(bob, { organizationId: workspaceId, name: "Billing", repository: RELAY_FULL_NAME }),
  );
  const caller = await agentOn(alice, invitations.id);
  assert.equal(await database.run(fillCodingAgentTitle(alice, caller.id, CALLER_TITLE)), true);
  const teammates = await agentOn(bob, billing.id);
  const archived = await agentOn(alice, invitations.id);
  await database.run(archiveCodingAgent(alice, archived.id, true));

  const elsewhere = await database.run(openWorkspace(carol));
  await database.run(joinWorkspace(elsewhere, alice));
  const elsewhereTask = await database.run(
    createTask(carol, {
      organizationId: elsewhere,
      name: "Elsewhere",
      repository: RELAY_FULL_NAME,
    }),
  );
  const otherWorkspaces = await agentOn(carol, elsewhereTask.id);

  const stranger = await database.createUser();
  const strangersTask = await database.run(
    startTask(stranger, { name: "Stranger's plan", repository: RELAY_FULL_NAME }),
  );
  const strangers = await agentOn(stranger, strangersTask.id);
  return {
    workspaceId,
    elsewhere,
    plans: { invitations: invitations.id, billing: billing.id, elsewhere: elsewhereTask.id },
    agents: { caller, teammates, archived, otherWorkspaces, strangers },
  };
}

test("list_agents names every other agent of the caller's workspace, on any task and by any member, each with its task and the mention it is named by, archived ones marked, and none of another workspace's; it narrows to one task by its id or to the caller's own", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const reading = {
    title: OPUS,
    model: OPUS,
    modelName: "Opus 5.5",
    effort: "high",
    activity: null,
  };
  const archived = {
    ...reading,
    id: agents.archived.id,
    status: CODING_AGENT_STATUS.STARTING,
    repository: RELAY_FULL_NAME,
    branch: null,
    task: { id: tasks.invitations, name: "Teammate invitations", archived: false },
    onYourTask: true,
    archived: true,
    mention: `[@${OPUS}](https://tryluke.dev/workspace-${workspaceId}/plan/${tasks.invitations}/agent/${agents.archived.id})`,
  };
  const teammates = {
    ...reading,
    id: agents.teammates.id,
    status: CODING_AGENT_STATUS.STARTING,
    repository: RELAY_FULL_NAME,
    branch: null,
    task: { id: tasks.billing, name: "Billing", archived: false },
    onYourTask: false,
    archived: false,
    mention: `[@${OPUS}](https://tryluke.dev/workspace-${workspaceId}/plan/${tasks.billing}/agent/${agents.teammates.id})`,
  };

  const listed = await call(CODER_TOOL.LIST_AGENTS, {});
  assert.equal(listed.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(listed));
  assert.deepEqual(listed.agents, [archived, teammates]);
  assert.deepEqual((await call(CODER_TOOL.LIST_AGENTS, { taskId: tasks.billing })).agents, [
    teammates,
  ]);
  assert.deepEqual((await call(CODER_TOOL.LIST_AGENTS, { thisTask: true })).agents, [archived]);
  assert.deepEqual(await call(CODER_TOOL.LIST_AGENTS, { taskId: tasks.billing, thisTask: true }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: AGENT_LIST_FILTER_REFUSAL.BOTH,
  });
  assert.equal(eve.sent.length, 0, "a list sends nothing");
});

test("read_agent reads a teammate's agent on another task of the caller's workspace, with the tail of its transcript in entries kept longer than Luke's and as many as asked, older turns included, and reads no agent of another workspace", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  // The teammate's final report runs past the short entry Luke summarises aloud.
  const report = Array.from(
    { length: 10 },
    () => "The invitations backfill stalls on rows whose inviter left the workspace.",
  ).join(" ");
  const answer = new AssistantMessageBuilder();
  answer.stepStart();
  answer.toolCall(
    { callId: "call-bash", name: CODER_TOOL.BASH, argumentsJson: "{}" },
    unparsedWire({ command: "pnpm test" }),
  );
  answer.toolResult("call-bash", {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
    output: unparsedWire({ exitCode: 1 }),
  });
  answer.stepStart();
  answer.text(report);
  await answeredTurnOn(agents.teammates, answer);

  const read = await call(CODER_TOOL.READ_AGENT, { agentId: agents.teammates.id });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(read));
  assert.ok(isRecord(read.agent));
  assert.equal(read.agent.id, agents.teammates.id);
  assert.deepEqual(read.agent.task, { id: tasks.billing, name: "Billing", archived: false });
  assert.deepEqual(tailTexts(read), ["Ran: pnpm test", `Said: ${report}`]);
  assert.deepEqual(
    tailTexts(await call(CODER_TOOL.READ_AGENT, { agentId: agents.teammates.id, entries: 1 })),
    [`Said: ${report}`],
  );
  // Each entry names the message it stands in, one turn's entries one message, which a fork names.
  const [firstTurn] = tailMessageIds(read);
  assert.ok(firstTurn !== undefined);
  assert.deepEqual(tailMessageIds(read), [firstTurn, firstTurn]);

  // A tail longer than the newest turns hold reaches back into older ones.
  for (const turn of [2, 3, 4]) {
    const later = new AssistantMessageBuilder();
    later.stepStart();
    later.text(`Turn ${turn} done.`);
    await answeredTurnOn(agents.teammates, later);
  }
  const longer = await call(CODER_TOOL.READ_AGENT, { agentId: agents.teammates.id, entries: 5 });
  assert.deepEqual(tailTexts(longer), [
    "Ran: pnpm test",
    `Said: ${report}`,
    "Said: Turn 2 done.",
    "Said: Turn 3 done.",
    "Said: Turn 4 done.",
  ]);
  assert.equal(
    new Set(tailMessageIds(longer)).size,
    4,
    "each turn's journal is a message of its own",
  );

  // An agent of another workspace is none of the caller's, even one its starter is also in.
  for (const other of [agents.otherWorkspaces, agents.strangers]) {
    assert.deepEqual(await call(CODER_TOOL.READ_AGENT, { agentId: other.id }), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT,
    });
  }
  assert.equal(eve.sent.length, 0, "a read sends nothing");
});

test("message_agent reaches a teammate's agent on another plan as the deployment acting for the caller's starter, opening with who sent it, kept under the sending agent, its name, and its model, and sent once under the call's key", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);

  const sent = await call(CODER_TOOL.MESSAGE_AGENT, { agentId: teammates.id, text: NOTE });
  assert.deepEqual(sent, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    delivery: STEER_OUTCOME.SENT,
    agent: {
      id: teammates.id,
      title: OPUS,
      model: OPUS,
      status: CODING_AGENT_STATUS.RUNNING,
      onYourTask: false,
    },
  });
  assert.equal(eve.sent.length, 1);
  const [request] = eve.sent;
  assert.equal(request?.path, `/eve/coder/v1/session/${teammates.sessionId}`);
  assert.equal(request?.headers.get("authorization"), `Bearer ${CRON_SECRET}`);
  assert.equal(request?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), caller.userId);
  assert.equal(request?.headers.get(BRAIN_HOST_HEADER.CONVERSATION), teammates.conversationId);
  // The words open with the sending agent, named and by the id it is answered by, then its own.
  const message: string = JSON.parse(request?.body ?? "").message;
  assert.ok(message.startsWith("A message from another coding agent"), message);
  assert.ok(message.includes(`"${CALLER_TITLE}"`) && message.includes(caller.id), message);
  assert.ok(message.includes("not the developer's or Luke's"), message);
  assert.ok(message.endsWith(`\n\n${NOTE}`), message);
  // The line stands in the teammate's agent's conversation, under its starter, named for the agent that sent it.
  assert.equal(
    await database.run(
      sentLineStands(teammates.userId, teammates.conversationId, sentLineId("call-1")),
    ),
    true,
  );
  // And by the model the sending agent runs on, which the window draws its harness by, and the agent itself on its task, which a reader opens.
  assert.deepEqual(await database.run(lineSenderUnder(teammates, "call-1")), {
    kind: MESSAGE_SENDER.AGENT,
    name: CALLER_TITLE,
    model: OPUS,
    agent: { id: caller.id, taskId: tasks.invitations },
  });

  const again = await call(CODER_TOOL.MESSAGE_AGENT, { agentId: teammates.id, text: NOTE });
  assert.equal(again.delivery, STEER_OUTCOME.REPEATED);
  assert.equal(eve.sent.length, 1, "the same call run again sends nothing more");

  // The longest message an agent may send arrives, heading and all, no longer than a member's may be.
  const longest = await call(
    CODER_TOOL.MESSAGE_AGENT,
    { agentId: teammates.id, text: "a".repeat(LONGEST_PEER_WORDS) },
    "call-longest",
  );
  assert.equal(longest.delivery, STEER_OUTCOME.SENT, JSON.stringify(longest));
  const delivered: string = JSON.parse(eve.sent[1]?.body ?? "").message;
  assert.ok(delivered.length <= CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS, String(delivered.length));
});

test("an MCP server or a Linear page another coding agent's message mentions is not handed to the agent it reaches, whose servers are its developer's to switch", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);

  const sent = await call(CODER_TOOL.MESSAGE_AGENT, {
    agentId: teammates.id,
    text: "See [@Linear](luke://mcp/linear) and [@LUKE-142 Token refresh fails](https://linear.app/acme/issue/LUKE-142).",
  });

  assert.equal(sent.delivery, STEER_OUTCOME.SENT, JSON.stringify(sent));
  assert.deepEqual(
    await database.run(takeCodingAgentMentionedServers(teammates.userId, teammates.conversationId)),
    [],
  );
});

test("message_agent sends nothing to an archived agent, an agent of another workspace, or the caller itself, and a deployment with no secret sends nothing", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const message = (agentId: string) => call(CODER_TOOL.MESSAGE_AGENT, { agentId, text: NOTE });

  assert.deepEqual(await message(agents.archived.id), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.AGENT_ARCHIVED,
  });
  // The starter is a member of the other workspace too, but the caller is not of it.
  assert.deepEqual(await message(agents.otherWorkspaces.id), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT,
  });
  assert.deepEqual(await message(agents.strangers.id), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT,
  });
  assert.deepEqual(await message(agents.caller.id), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.SELF,
  });
  // A coding agent's words that leave its heading no room within a member's bound are refused whole.
  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, {
      agentId: agents.teammates.id,
      text: "a".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
    }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.TOO_LONG },
  );
  assert.equal(eve.sent.length, 0);
  assert.equal(
    await database.run(
      sentLineStands(agents.archived.userId, agents.archived.conversationId, sentLineId("call-1")),
    ),
    false,
    "an archived agent is written nothing",
  );

  const unsecured = await peerCaller(hostOf(false), agents.caller, eve.services);
  assert.deepEqual(
    await unsecured(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.NO_SERVICE },
  );
  assert.equal(eve.sent.length, 0);
});

test("start_agent starts an agent on the caller's own task as the deployment acting for its starter, answering the mention it is named by, telling it which agent started it and how to report back, leaves the starter's default as it stood, and starts once under the call's key", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const prompt = "Write the migration that adds the invitation's expiry.";

  const started = await call(
    CODER_TOOL.START_AGENT,
    { prompt, model: OPUS, effort: "low" },
    "call-start",
  );
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id));
  const startedId = started.agent.id;
  const stored = Option.getOrThrow(await database.run(readCodingAgent(caller.userId, startedId)));
  assert.equal(stored.taskId, tasks.invitations);
  // The agent is answered with the mention its starter names it by, its title the model's until one is written.
  assert.equal(
    started.agent.mention,
    `[@${OPUS}](https://tryluke.dev/workspace-${workspaceId}/plan/${tasks.invitations}/agent/${startedId})`,
  );
  assert.deepEqual([stored.model, stored.effort], [OPUS, "low"]);

  assert.equal(eve.sent.length, 1);
  const [opening] = eve.sent;
  assert.equal(opening?.path, "/eve/coder/v1/session");
  assert.equal(opening?.headers.get(BRAIN_HOST_HEADER.ACCOUNT), caller.userId);
  const message: string = JSON.parse(opening?.body ?? "").message;
  assert.ok(message.startsWith(prompt), message);
  assert.ok(message.includes(START_NOTE_HEADING.AGENT), message);
  assert.ok(message.includes(`"${CALLER_TITLE}"`) && message.includes(caller.id), message);
  // An agent's own pick of a model is no member's new default.
  assert.equal((await database.run(readAccountPreferences(caller.userId)))?.codingAgent, undefined);

  const again = await call(CODER_TOOL.START_AGENT, { prompt }, "call-start");
  assert.ok(isRecord(again.agent));
  assert.equal(again.agent.id, startedId);
  assert.equal(eve.sent.length, 1, "the same call run again starts no second agent");
});

test("start_agent hands over a prompt and a note each as long as a start allows, whole in the agent's first message, and refuses either past it, starting nothing", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const longest = CODING_AGENT_BOUNDS.MAX_START_WORDS_CHARS;
  const prompt = `Brief: ${"p".repeat(longest - 8)}.`;
  const note = `Note: ${"n".repeat(longest - 7)}.`;

  for (const [refused, key] of [
    [{ prompt: `${prompt}p`, note }, "call-long-prompt"],
    [{ prompt, note: `${note}n` }, "call-long-note"],
  ] as const) {
    assert.deepEqual(await call(CODER_TOOL.START_AGENT, refused, key), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: START_CODING_AGENT_REFUSAL.UNREADABLE,
    });
  }
  assert.equal(eve.sent.length, 0, "a start past the bound starts nothing");

  const started = await call(CODER_TOOL.START_AGENT, { prompt, note }, "call-longest");
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.equal(eve.sent.length, 1);
  const message: string = JSON.parse(eve.sent[0]?.body ?? "").message;
  assert.ok(message.startsWith(prompt), "the prompt opens the first message whole");
  assert.ok(message.includes(`\n\n${note}`), "the note follows it whole");
});

test("start_agent with a title names the agent by it from the start, and a title generated later never covers it; an empty or over-long title starts nothing", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const title = "start_agent takes a title";

  const started = await call(
    CODER_TOOL.START_AGENT,
    { prompt: "Add a title to start_agent.", title: `  ${title}  ` },
    "call-titled",
  );
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id));
  const startedId = started.agent.id;
  assert.equal(
    started.agent.mention,
    `[@${title}](https://tryluke.dev/workspace-${workspaceId}/plan/${tasks.invitations}/agent/${startedId})`,
  );

  // The title generated as the agent's words arrive is filled only where none stands.
  assert.equal(
    await database.run(fillCodingAgentTitle(caller.userId, startedId, "Generated name")),
    false,
  );
  const stored = Option.getOrThrow(await database.run(readCodingAgent(caller.userId, startedId)));
  assert.equal(stored.title, title);

  for (const [refused, key] of [
    ["   ", "call-empty"],
    ["a".repeat(CODING_AGENT_BOUNDS.MAX_TITLE_CHARS + 1), "call-long"],
  ] as const) {
    assert.deepEqual(await call(CODER_TOOL.START_AGENT, { title: refused }, key), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: START_CODING_AGENT_REFUSAL.UNREADABLE,
    });
  }
});

test("start_agent with a branch starts an agent whose checkout is cloned at that branch and who is told to cut its own from it, and a branch GitHub does not hold is refused before anything starts", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const { caller } = agents;
  const branches = [STACKED_BRANCH];
  const eve = await fakeCoderEve(workspaceId, branches);
  const host = hostOf(true);
  const call = await peerCaller(host, caller, eve.services);
  const prompt = "Send the reminder before the invitation expires.";

  assert.deepEqual(
    await call(CODER_TOOL.START_AGENT, { prompt, branch: "luke/never-pushed" }, "call-missing"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.NO_BRANCH },
  );
  assert.equal(eve.sent.length, 0, "a branch GitHub does not hold starts nothing");
  assert.deepEqual(
    await call(CODER_TOOL.START_AGENT, { prompt, branch: "two words" }, "call-unreadable"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.UNREADABLE },
  );

  const started = await call(
    CODER_TOOL.START_AGENT,
    { prompt, branch: STACKED_BRANCH },
    "call-stacked",
  );
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id));
  assert.equal(eve.sent.length, 1);

  // The started agent's own session checks its repository out at the branch named.
  const stored = Option.getOrThrow(
    await database.run(readCodingAgent(caller.userId, started.agent.id)),
  );
  const target = { userId: caller.userId, conversationId: stored.conversationId };
  const session = sessionId();
  assert.equal(await database.run(claimRuntimeSession(target, session, new Date(NOW))), true);
  const admitted = await database.run(host.admit(seat(target), session));
  if (Result.isFailure(admitted)) return assert.fail(admitted.failure);
  const sandbox = sandboxDouble(() => undefined);
  await database.run(host.checkOut(admitted.success, sandbox).pipe(Effect.provide(eve.services)));
  assert.deepEqual(
    sandbox.clones.map((clone) => clone.branch),
    [STACKED_BRANCH],
  );
  const instructions = await database.run(
    host.prompt(admitted.success, stored).pipe(Effect.provide(eve.services)),
  );
  assert.ok(
    instructions.text.includes(`cut from \`${STACKED_BRANCH}\`, the branch you were started on`),
    instructions.text,
  );
  assert.ok(
    instructions.text.includes(`started on \`${STACKED_BRANCH}\`, so pass it as \`base\``),
    instructions.text,
  );

  // A turn that ends on the branch it started on records no branch of its own, so the pull request
  // already on that branch is never taken for this agent's; one it cut is recorded.
  let standing = STACKED_BRANCH;
  const shell = sandboxDouble((command) =>
    command === "git branch --show-current"
      ? { exitCode: 0, stdout: `${standing}\n`, stderr: "" }
      : undefined,
  );
  shell.checkedOut = RELAY_FULL_NAME;
  const branchOf = async () =>
    Option.getOrThrow(await database.run(readCodingAgent(caller.userId, stored.id))).branch;
  await database.run(host.recordBranch(admitted.success, shell));
  assert.equal(await branchOf(), null);
  standing = "luke/invitation-reminder";
  await database.run(host.recordBranch(admitted.success, shell));
  assert.equal(await branchOf(), standing);

  // The same call run again once the branch is gone answers the agent its start made.
  branches.length = 0;
  const again = await call(
    CODER_TOOL.START_AGENT,
    { prompt, branch: STACKED_BRANCH },
    "call-stacked",
  );
  assert.ok(isRecord(again.agent), JSON.stringify(again));
  assert.equal(again.agent.id, stored.id);
  assert.equal(eve.sent.length, 1, "the call run again starts nothing");
});

test("list_models answers exactly the choices start_agent takes, as the caller's starter is offered them: every model and effort it lists starts an agent, a fast version the starter's key may not run is neither listed nor started on, and a start naming neither runs on the default it lists", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const offered: readonly OfferedModel[] = [
    ...CATALOG,
    {
      id: OPUS_FAST,
      name: "Claude Opus 5.5 Fast",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["high"],
    },
    { id: SOL, name: "GPT-6.1 Sol", provider: MODEL_PROVIDER.OPENAI, efforts: ["low", "high"] },
  ];
  // Luke's own Anthropic key, which the starter's agents run on, was never granted fast mode.
  const catalog = modelCatalogOf(offered, FAST_ACCESS.NOT_ENABLED);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services, catalog);

  const listed = await call(CODER_TOOL.LIST_MODELS, {});
  assert.deepEqual(listed, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    models: [
      { id: OPUS, name: "Opus 5.5", efforts: ["low", "medium", "high", "max"] },
      { id: SOL, name: "GPT-6.1 Sol", efforts: ["low", "high"] },
    ],
    default: { model: OPUS, modelName: "Opus 5.5", effort: "high", offered: true },
  });

  let calls = 0;
  for (const model of [OPUS, SOL]) {
    for (const effort of model === OPUS ? ["low", "medium", "high", "max"] : ["low", "high"]) {
      calls += 1;
      const started = await call(CODER_TOOL.START_AGENT, { model, effort }, `call-${calls}`);
      assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
      assert.ok(isRecord(started.agent));
      assert.deepEqual([started.agent.model, started.agent.effort], [model, effort]);
    }
  }
  const fast = await call(
    CODER_TOOL.START_AGENT,
    { model: OPUS_FAST, effort: "high" },
    "call-fast",
  );
  assert.equal(fast.status, ACTION_RESULT_STATUS.REJECTED);
  // The refusal lists the choices list_models does, and not the version it refused.
  assert.ok(
    String(fast.reason).endsWith(
      "The choices are: anthropic/claude-opus-5.5 (low, medium, high, max); openai/gpt-6.1-sol (low, high).",
    ),
    String(fast.reason),
  );
  const unnamed = await call(CODER_TOOL.START_AGENT, {}, "call-default");
  assert.ok(isRecord(unnamed.agent), JSON.stringify(unnamed));
  assert.deepEqual(
    [unnamed.agent.model, unnamed.agent.effort],
    [CODING_AGENT_DEFAULT_CHOICE.model, CODING_AGENT_DEFAULT_CHOICE.effort],
  );
});

test("list_models says the default is no longer offered where the catalog dropped it, as a start naming neither is then refused, and refuses to list from a catalog it cannot read", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const sol: OfferedModel = {
    id: SOL,
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  };
  const call = await peerCaller(hostOf(true), agents.caller, eve.services, modelCatalogOf([sol]));

  const listed = await call(CODER_TOOL.LIST_MODELS, {});
  assert.deepEqual(listed.default, {
    model: OPUS,
    modelName: "Opus 5.5",
    effort: "high",
    offered: false,
  });
  const unnamed = await call(CODER_TOOL.START_AGENT, {}, "call-default");
  assert.equal(unnamed.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(eve.sent.length, 0);

  // A refusal lists the models the start was checked against, even where the catalog fails on any later read.
  let reads = 0;
  const flaky = Layer.succeed(ModelCatalog, {
    read: Effect.suspend(() => {
      reads += 1;
      return reads === 1
        ? Effect.succeed([sol])
        : Effect.fail(new ModelCatalogUnavailable({ cause: "offline" }));
    }),
    lukeFastAccess: Effect.succeed(undefined),
  });
  const once = await peerCaller(hostOf(true), agents.caller, eve.services, flaky);
  const refused = await once(CODER_TOOL.START_AGENT, { model: SOL, effort: "max" }, "call-max");
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.ok(String(refused.reason).endsWith("The choices are: openai/gpt-6.1-sol (low, high)."));

  const unreadable = Layer.succeed(ModelCatalog, {
    read: Effect.fail(new ModelCatalogUnavailable({ cause: "offline" })),
    lukeFastAccess: Effect.succeed(undefined),
  });
  const blind = await peerCaller(hostOf(true), agents.caller, eve.services, unreadable);
  assert.deepEqual(await blind(CODER_TOOL.LIST_MODELS, {}), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: LIST_MODELS_REFUSAL.UNAVAILABLE,
  });
});

/** An agent's turn that ended on the words given, so the agent reads as done and has a message to fork at. */
async function saidTurnOn(agent: StartedAgent, words: string): Promise<void> {
  const answer = new AssistantMessageBuilder();
  answer.stepStart();
  answer.text(words);
  await answeredTurnOn(agent, answer);
}

/** The words of the newest session eve was asked to open. */
function openingWords(sent: Awaited<ReturnType<typeof fakeCoderEve>>["sent"]): string {
  const opening = sent.findLast((each) => each.path === "/eve/coder/v1/session");
  return JSON.stringify(JSON.parse(opening?.body ?? "{}").message);
}

/** The agent a start answered, as the store holds it. */
async function storedStart(userId: string, started: WireRecord) {
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id));
  return Option.getOrThrow(await database.run(readCodingAgent(userId, started.agent.id)));
}

test("start_agent continues a teammate's agent that ended, on that agent's own task when none is named, handed its transcript and named after it; the same call run again answers the agent it made, and a second continue starts another, its answer, and that call's run again, naming the first", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  await database.run(fillCodingAgentTitle(teammates.userId, teammates.id, "Invoice export"));
  await saidTurnOn(teammates, "The export is half done; the CSV writer is next.");
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);

  const from = { agentId: teammates.id };
  const started = await call(CODER_TOOL.START_AGENT, { from, note: NOTE }, "call-continue");
  const stored = await storedStart(caller.userId, started);
  assert.equal(stored.taskId, tasks.billing, "the task is the source's own");
  assert.equal(stored.startedFrom?.agentId, teammates.id);
  assert.equal(stored.startedFrom?.messageId, undefined);
  assert.equal(stored.title, "Invoice export (continued)");
  const words = openingWords(eve.sent);
  assert.ok(words.includes("the CSV writer is next"), words);
  assert.ok(words.includes(NOTE) && words.includes(caller.id), words);

  const again = await call(CODER_TOOL.START_AGENT, { from, note: NOTE }, "call-continue");
  assert.ok(isRecord(again.agent), JSON.stringify(again));
  assert.equal(again.agent.id, stored.id);
  const openings = eve.sent.filter((each) => each.path === "/eve/coder/v1/session").length;

  assert.equal(
    eve.sent.filter((each) => each.path === "/eve/coder/v1/session").length,
    openings,
    "the call run again opens no session",
  );
  assert.equal(again.earlierContinuations, undefined, "the first continue names none before it");

  const second = await call(CODER_TOOL.START_AGENT, { from }, "call-continue-again");
  const secondStored = await storedStart(caller.userId, second);
  assert.notEqual(secondStored.id, stored.id, "a second continue is an agent of its own");
  assert.equal(secondStored.startedFrom?.agentId, teammates.id);
  assert.equal(secondStored.taskId, tasks.billing);
  assert.equal(
    eve.sent.filter((each) => each.path === "/eve/coder/v1/session").length,
    openings + 1,
    "and opens a session of its own",
  );
  const first = {
    id: stored.id,
    mention: `[@Invoice export (continued)](https://tryluke.dev/workspace-${workspaceId}/plan/${tasks.billing}/agent/${stored.id})`,
  };
  assert.deepEqual(second.earlierContinuations, [first]);

  const secondAgain = await call(CODER_TOOL.START_AGENT, { from }, "call-continue-again");
  assert.ok(isRecord(secondAgain.agent), JSON.stringify(secondAgain));
  assert.equal(secondAgain.agent.id, secondStored.id, "the call run again answers what it made");
  assert.deepEqual(secondAgain.earlierContinuations, [first], "naming the first as it did");
});

test("start_agent forks an agent at one of its messages that read_agent names, while that agent still works, and leaves the agent going on", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  await saidTurnOn(teammates, "First I tried the streaming writer.");
  await saidTurnOn(teammates, "Then I switched to a buffered one.");
  await turnOn(teammates, false);
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);

  const read = await call(CODER_TOOL.READ_AGENT, { agentId: teammates.id });
  const [messageId] = tailMessageIds(read);
  assert.ok(messageId !== undefined);
  const started = await call(
    CODER_TOOL.START_AGENT,
    { from: { agentId: teammates.id, messageId } },
    "call-fork",
  );
  const stored = await storedStart(caller.userId, started);
  assert.equal(stored.taskId, tasks.billing);
  assert.deepEqual(stored.startedFrom?.messageId, messageId);
  const words = openingWords(eve.sent);
  assert.ok(words.includes("streaming writer"), words);
  assert.ok(!words.includes("buffered one"), "a fork is handed the transcript up to its message");
  assert.ok(
    !eve.sent.some((each) => each.path.endsWith("/cancel")),
    "a fork leaves its source going on",
  );
});

test("start_agent from another agent refuses, in words the model acts on and starting nothing, an agent of no workspace of the caller's, a message none of the source's, a prompt, a branch, or a new task beside it, the caller continuing itself, a source still working, a task other than the source's, an archived task, and a source on no task", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const refused = async (input: WireBoundaryInput, reason: string) =>
    assert.deepEqual(await call(CODER_TOOL.START_AGENT, input, `call-${randomUUID()}`), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason,
    });
  const R = START_CODING_AGENT_REFUSAL;
  await saidTurnOn(caller, "Done with the expiry.");

  for (const other of [agents.otherWorkspaces, agents.strangers]) {
    await refused({ from: { agentId: other.id } }, R.NO_SOURCE);
  }
  await refused({ from: { agentId: randomUUID() } }, R.NO_SOURCE);
  await refused({ from: { agentId: teammates.id, messageId: randomUUID() } }, R.NO_MESSAGE);
  await refused({ from: { agentId: teammates.id }, prompt: "Do it again." }, R.FROM_WITH_PROMPT);
  await refused({ from: { agentId: teammates.id }, branch: STACKED_BRANCH }, R.FROM_WITH_PROMPT);
  await refused({ from: { agentId: caller.id } }, R.SELF_CONTINUE);
  // A teammate's agent with no turn yet is still starting, and one whose turn runs is working.
  await refused({ from: { agentId: teammates.id } }, R.SOURCE_RUNNING);
  await turnOn(teammates, false);
  await refused({ from: { agentId: teammates.id } }, R.SOURCE_RUNNING);
  await saidTurnOn(teammates, "Stopped for the day.");
  await refused(
    { from: { agentId: teammates.id }, taskId: tasks.invitations },
    R.SOURCE_OTHER_TASK,
  );
  await database.run(
    Effect.flatMap(Database, (db) =>
      db
        .update(task)
        .set({ archivedAt: new Date(NOW) })
        .where(eq(task.id, tasks.billing)),
    ),
  );
  await refused({ from: { agentId: teammates.id } }, R.ARCHIVED);
  const sweeper = await tasklessAgentOn(teammates.userId, workspaceId);
  await saidTurnOn(sweeper, "Swept.");
  await refused({ from: { agentId: sweeper.id } }, R.SOURCE_NO_TASK);
  assert.equal(eve.sent.length, 0, "no refusal opens a session");
});

/** A teammate's agent on the task given, started on the branch given, its session recorded. */
async function agentOnBranch(
  userId: string,
  taskId: string,
  branch: string,
): Promise<StartedAgent> {
  return claimed(userId, {
    ...AGENT_CHOICE,
    idempotencyKey: randomUUID(),
    taskId: taskId,
    planSnapshot: "# Billing",
    prompt: null,
    startBranch: branch,
  });
}

test("start_agent continuing an agent started on a branch clones the new agent at that branch, or at the default branch where GitHub no longer holds it", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  const held = await agentOnBranch(teammates.userId, tasks.billing, STACKED_BRANCH);
  const gone = await agentOnBranch(teammates.userId, tasks.billing, "luke/merged-and-deleted");
  await saidTurnOn(held, "The base is in review.");
  await saidTurnOn(gone, "The base merged.");
  const eve = await fakeCoderEve(workspaceId, [STACKED_BRANCH]);
  const call = await peerCaller(hostOf(true), caller, eve.services);

  const onHeld = await call(CODER_TOOL.START_AGENT, { from: { agentId: held.id } }, "call-held");
  const stored = await storedStart(caller.userId, onHeld);
  assert.equal(stored.startedFrom?.agentId, held.id);
  assert.equal(stored.startBranch, STACKED_BRANCH);
  const onGone = await call(CODER_TOOL.START_AGENT, { from: { agentId: gone.id } }, "call-gone");
  assert.equal((await storedStart(caller.userId, onGone)).startBranch, null);
});

test("start_agent refuses to continue an agent whose session died while it still reads running, pointing at stop_agent, which settles it, and then continues it", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  await saidTurnOn(teammates, "Halfway through the CSV writer.");
  await turnOn(teammates, false);
  const eve = await fakeCoderEve(workspaceId, [], undefined, "no_active_turn");
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const from = { agentId: teammates.id };

  assert.deepEqual(await call(CODER_TOOL.START_AGENT, { from }, "call-1"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.SOURCE_RUNNING,
  });
  assert.ok(START_CODING_AGENT_REFUSAL.SOURCE_RUNNING.includes(CODER_TOOL.STOP_AGENT));
  // eve runs no turn on the dead session, so the Stop stops nothing there, yet the turn reads cancelled.
  const stopped = await call(CODER_TOOL.STOP_AGENT, from, "call-2");
  assert.equal(stopped.stopped, false, JSON.stringify(stopped));
  assert.ok(isRecord(stopped.agent));
  assert.equal(stopped.agent.status, CODING_AGENT_STATUS.CANCELLED);

  const continued = await call(CODER_TOOL.START_AGENT, { from }, "call-3");
  const stored = await storedStart(caller.userId, continued);
  assert.equal(stored.taskId, tasks.billing);
  assert.equal(stored.startedFrom?.agentId, teammates.id);
  assert.ok(openingWords(eve.sent).includes("CSV writer"));
});

test("start_agent from a source whose transcript does not fit the new agent's window hands it Luke's summary of the steps left out, written on the deployment's summary model", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  await database.run(
    Effect.flatMap(Database, (db) =>
      db
        .update(codingAgent)
        .set({ model: SMALL_WINDOW.model })
        .where(eq(codingAgent.id, teammates.id)),
    ),
  );
  for (let turn = 0; turn < 30; turn += 1) {
    await saidTurnOn(teammates, `Step ${turn}. ${"x".repeat(5_000)}`);
  }
  const recap = "Recap: the teammate asked for step after step.";
  const summaryModel: SummaryModelOf = () =>
    Effect.succeed({
      model: new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text", text: recap }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        }),
      }),
      providerOptions: {},
      counted: Effect.void,
    });
  const eve = await fakeCoderEve(workspaceId);
  const small: OfferedModel = {
    id: SMALL_WINDOW.model,
    name: "Claude Sonnet 4.9",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
    contextWindow: SMALL_WINDOW.tokens,
  };
  const catalog = modelCatalogOf([...CATALOG, small]);
  const call = await peerCaller(hostOf(true, summaryModel), caller, eve.services, catalog);

  await storedStart(
    caller.userId,
    await call(CODER_TOOL.START_AGENT, { from: { agentId: teammates.id } }, "call-long"),
  );
  const words = openingWords(eve.sent);
  assert.ok(words.includes(recap), "the steps left out are summarized");
  assert.ok(words.includes("Step 29."), "the newest steps are kept whole");
});

test("list_tasks names the open tasks of the caller's workspace, each with the mention it is named by, its own marked, and none of another's; start_agent starts on another of them by its taskId, refuses one of another workspace, and an agent on no task names its task or is refused", async () => {
  const { workspaceId, elsewhere, plans: taskIds, agents } = await openWorkspaces();
  const { caller } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);

  const listed = await call(CODER_TOOL.LIST_TASKS, {});
  assert.equal(listed.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(listed));
  assert.ok(Array.isArray(listed.tasks));
  const tasks = listed.tasks.flatMap((task) =>
    isRecord(task)
      ? [{ id: task.id, name: task.name, isYourTask: task.isYourTask, mention: task.mention }]
      : [],
  );
  const home = `https://tryluke.dev/workspace-${workspaceId}/plan`;
  assert.deepEqual(
    [...tasks].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [
      {
        id: taskIds.billing,
        name: "Billing",
        isYourTask: false,
        mention: `[@Billing](${home}/${taskIds.billing})`,
      },
      {
        id: taskIds.invitations,
        name: "Teammate invitations",
        isYourTask: true,
        mention: `[@Teammate invitations](${home}/${taskIds.invitations})`,
      },
    ],
  );

  // Narrowed by words of a name, whatever their case, and paged by an offset.
  const billing = await call(CODER_TOOL.LIST_TASKS, { nameContains: "BILL" });
  assert.deepEqual(
    Array.isArray(billing.tasks) ? billing.tasks.map((task) => isRecord(task) && task.id) : [],
    [taskIds.billing],
  );
  assert.equal(billing.nextOffset, null);
  const paged = await call(CODER_TOOL.LIST_TASKS, { offset: 1 });
  assert.equal(Array.isArray(paged.tasks) ? paged.tasks.length : -1, 1);
  assert.deepEqual(await call(CODER_TOOL.LIST_TASKS, { offset: -1 }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.UNREADABLE_TASKS,
  });

  const started = await call(
    CODER_TOOL.START_AGENT,
    { taskId: taskIds.billing, prompt: "Add the invoice export." },
    "call-billing",
  );
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id));
  const stored = Option.getOrThrow(
    await database.run(readCodingAgent(caller.userId, started.agent.id)),
  );
  assert.equal(stored.taskId, taskIds.billing);
  assert.equal(started.agent.onYourTask, false, "an agent started on another task is said to be");
  assert.equal(eve.sent.length, 1);
  // The same call run again answers the agent it made, and starts nothing.
  const again = await call(
    CODER_TOOL.START_AGENT,
    { taskId: taskIds.billing, prompt: "Add the invoice export." },
    "call-billing",
  );
  assert.ok(isRecord(again.agent), JSON.stringify(again));
  assert.equal(again.agent.id, started.agent.id);
  // Once its task has moved to another workspace, its agents with it as a move takes them, the call
  // tells nothing of that agent and still starts none.
  await database.run(
    Effect.flatMap(Database, (db) =>
      Effect.andThen(
        db.update(task).set({ organizationId: elsewhere }).where(eq(task.id, taskIds.billing)),
        db
          .update(codingAgent)
          .set({ organizationId: elsewhere })
          .where(eq(codingAgent.taskId, taskIds.billing)),
      ),
    ),
  );
  assert.deepEqual(
    await call(
      CODER_TOOL.START_AGENT,
      { taskId: taskIds.billing, prompt: "Add the invoice export." },
      "call-billing",
    ),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.NO_SUCH_TASK },
  );
  assert.equal(eve.sent.length, 1, "the call run again starts nothing");

  assert.deepEqual(
    await call(
      CODER_TOOL.START_AGENT,
      { taskId: taskIds.elsewhere, prompt: "Add the invoice export." },
      "call-elsewhere",
    ),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.NO_SUCH_TASK },
  );
  assert.equal(eve.sent.length, 1, "a task of another workspace starts nothing");

  // An agent on no task is offered the tool too, and names the task it starts on.
  const sweeper = await tasklessAgentOn(caller.userId, workspaceId);
  const fromNoTask = await peerCaller(hostOf(true), sweeper, eve.services);
  assert.deepEqual(await fromNoTask(CODER_TOOL.START_AGENT, { prompt: "Sweep." }, "call-none"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.NO_TASK,
  });
  const onTask = await fromNoTask(
    CODER_TOOL.START_AGENT,
    { taskId: taskIds.invitations, prompt: "Sweep the invitation tests." },
    "call-task",
  );
  assert.equal(onTask.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(onTask));
  assert.equal(eve.sent.length, 2);
});

test("create_task links the GitHub and Linear issues named, each read through the workspace first with its keyword, and one named wrong or read for none makes no task", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const bob = agents.teammates.userId;
  const caller = await agentOn(bob, tasks.invitations);
  const call = await peerCaller(
    hostOf(true),
    caller,
    await issueReadingGitHub(workspaceId),
    modelCatalogOf(CATALOG),
    LINEAR_CONNECTED,
  );

  const made = await call(
    CODER_TOOL.CREATE_TASK,
    {
      name: "Invite expiry",
      issues: [
        { issue: "#7" },
        { issue: "eng-42", relation: TASK_ISSUE_RELATION.PART_OF },
        { issue: `https://github.com/${RELAY_FULL_NAME}/issues/8` },
      ],
    },
    "call-linked",
  );
  const unnamed = await call(
    CODER_TOOL.CREATE_TASK,
    { name: "Unnamed", issues: [{ issue: "the login bug" }] },
    "call-unnamed",
  );
  const unread = await call(
    CODER_TOOL.CREATE_TASK,
    { name: "Unread", issues: [{ issue: `${RELAY_FULL_NAME}#99` }] },
    "call-unread",
  );

  assert.equal(made.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(made));
  assert.ok(isRecord(made.task), JSON.stringify(made));
  assert.deepEqual(made.task.issues, [
    {
      provider: TASK_ISSUE_PROVIDER.GITHUB,
      key: `${RELAY_FULL_NAME}#7`,
      title: "Relay issue 7",
      url: `https://github.com/${RELAY_FULL_NAME}/issues/7`,
      relation: TASK_ISSUE_RELATION.CLOSES,
    },
    {
      provider: TASK_ISSUE_PROVIDER.LINEAR,
      key: "ENG-42",
      title: LINEAR_ISSUE.title,
      url: LINEAR_ISSUE.url,
      relation: TASK_ISSUE_RELATION.PART_OF,
    },
    {
      provider: TASK_ISSUE_PROVIDER.GITHUB,
      key: `${RELAY_FULL_NAME}#8`,
      title: "Relay issue 8",
      url: `https://github.com/${RELAY_FULL_NAME}/issues/8`,
      relation: TASK_ISSUE_RELATION.CLOSES,
    },
  ]);
  assert.deepEqual(unnamed, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: TASK_ISSUE_REFUSAL.UNNAMED("the login bug"),
  });
  assert.deepEqual(unread, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: TASK_ISSUE_REFUSAL.NOT_FOUND(`${RELAY_FULL_NAME}#99`),
  });
  assert.deepEqual(await tasksNamed(bob, workspaceId, "Unnamed"), []);
  assert.deepEqual(await tasksNamed(bob, workspaceId, "Unread"), []);
});

test("update_task links, relates, and unlinks a task's issues by name, answers the issues it then links, refuses one the task does not link, and an archived task takes none", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const bob = agents.teammates.userId;
  const caller = await agentOn(bob, tasks.invitations);
  const call = await peerCaller(
    hostOf(true),
    caller,
    await issueReadingGitHub(workspaceId),
    modelCatalogOf(CATALOG),
    LINEAR_CONNECTED,
  );
  const made = await call(
    CODER_TOOL.CREATE_TASK,
    { name: "Invite expiry", issues: [{ issue: "#7" }] },
    "call-made",
  );
  assert.ok(isRecord(made.task) && isWireString(made.task.id), JSON.stringify(made));
  const taskId = made.task.id;
  const keysAndKeywords = (answer: WireRecord) => {
    assert.ok(isRecord(answer.task) && Array.isArray(answer.task.issues), JSON.stringify(answer));
    return answer.task.issues.map((each) =>
      isRecord(each) ? [each.key, each.relation] : assert.fail("an issue is a record"),
    );
  };

  const relinked = await call(CODER_TOOL.UPDATE_TASK, {
    taskId,
    linkIssues: [{ issue: "ENG-42" }, { issue: `${RELAY_FULL_NAME}#8` }],
    relateIssues: [
      {
        issue: `https://github.com/${RELAY_FULL_NAME}/issues/7`,
        relation: TASK_ISSUE_RELATION.PART_OF,
      },
    ],
  });
  const unlinked = await call(CODER_TOOL.UPDATE_TASK, { taskId, unlinkIssues: ["eng-42"] });
  const again = await call(CODER_TOOL.UPDATE_TASK, {
    taskId,
    relateIssues: [{ issue: "#7", relation: TASK_ISSUE_RELATION.PART_OF }],
  });
  const notLinked = await call(CODER_TOOL.UPDATE_TASK, { taskId, unlinkIssues: ["ENG-1"] });
  // #N names a link of the repository the task stands on before the call takes it away.
  const unlinkedAway = await call(CODER_TOOL.UPDATE_TASK, {
    taskId,
    repository: null,
    unlinkIssues: ["#8"],
  });
  await call(CODER_TOOL.UPDATE_TASK, { taskId, archived: true });
  const archived = await call(CODER_TOOL.UPDATE_TASK, {
    taskId,
    unlinkIssues: [`${RELAY_FULL_NAME}#7`],
  });

  assert.deepEqual(keysAndKeywords(relinked), [
    [`${RELAY_FULL_NAME}#7`, TASK_ISSUE_RELATION.PART_OF],
    ["ENG-42", TASK_ISSUE_RELATION.CLOSES],
    [`${RELAY_FULL_NAME}#8`, TASK_ISSUE_RELATION.CLOSES],
  ]);
  assert.equal(relinked.already, false);
  assert.deepEqual(keysAndKeywords(unlinkedAway), [
    [`${RELAY_FULL_NAME}#7`, TASK_ISSUE_RELATION.PART_OF],
  ]);
  assert.deepEqual(keysAndKeywords(unlinked), [
    [`${RELAY_FULL_NAME}#7`, TASK_ISSUE_RELATION.PART_OF],
    [`${RELAY_FULL_NAME}#8`, TASK_ISSUE_RELATION.CLOSES],
  ]);
  assert.equal(again.already, true);
  assert.deepEqual(notLinked, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: TASK_ISSUE_REFUSAL.NOT_LINKED("ENG-1"),
  });
  assert.deepEqual(archived, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: UPDATE_TASK_REFUSAL.ARCHIVED,
  });
  assert.deepEqual(
    Option.getOrThrow(await database.run(readTask(bob, taskId))).issueLinks.map(({ key }) => key),
    [`${RELAY_FULL_NAME}#7`],
  );
});

/** The ids of the tasks of the workspace the account reads under the name, newest first. */
async function tasksNamed(userId: string, workspaceId: string, name: string): Promise<string[]> {
  const listed = await database.run(listTasks(userId));
  return listed
    .filter((each) => each.workspaceId === workspaceId && each.name === name)
    .map((each) => each.id);
}

test("create_task makes a task in the caller's workspace for the member the agent acts for, on the repository it works in unless another or none is named, with the brief and plan given and no agent on it, once under the call's key; start_agent then starts on it by its id", async () => {
  const { workspaceId, elsewhere, plans: tasks, agents } = await openWorkspaces();
  // Bob's agent on Alice's task: the task it makes is Bob's, not the owner's of the task it works on.
  const bob = agents.teammates.userId;
  const caller = await agentOn(bob, tasks.invitations);
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const name = "Invite expiry migration";
  // A plan handed with its # title keeps its body alone, the task's name standing for the title.
  const body = "## Goal\n\nAdd the invitation's expiry.";
  const plan = `# ${name}\n\n${body}`;
  const countedBefore = tasksCounted(bob);

  const made = await call(
    CODER_TOOL.CREATE_TASK,
    { name: ` ${name} `, brief: "Invites should lapse after a week.", plan },
    "call-new",
  );
  assert.equal(made.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(made));
  assert.ok(isRecord(made.task) && isWireString(made.task.id), JSON.stringify(made));
  const taskId = made.task.id;
  const stored = Option.getOrThrow(await database.run(readTask(bob, taskId)));
  assert.deepEqual(made.task, {
    id: taskId,
    key: `TW-${stored.task.number}`,
    status: TASK_STATUS.TODO,
    priority: TASK_PRIORITY.NONE,
    name,
    repository: RELAY_FULL_NAME,
    mention: `[@${name}](https://tryluke.dev/workspace-${workspaceId}/plan/${taskId})`,
  });
  assert.deepEqual(
    [stored.ownerId, stored.task.workspaceId, stored.task.repository, stored.text, stored.brief],
    [bob, workspaceId, RELAY_FULL_NAME, body, "Invites should lapse after a week."],
  );
  // Its plan's first revision is the calling agent's, as its history shows it.
  const history = await database.run(listRevisions(bob, taskId));
  assert.deepEqual(
    history.revisions.map((revision) => revision.agentId),
    [caller.id],
  );
  assert.equal(eve.sent.length, 0, "a task is made with no agent on it");
  // It stands in the workspace's list as any task does, for a teammate too, and in no other workspace.
  const alice = agents.caller.userId;
  assert.deepEqual(await tasksNamed(alice, workspaceId, name), [taskId]);
  assert.deepEqual(await tasksNamed(alice, elsewhere, name), []);

  // A title in a plan written with CRLF line ends is dropped as well.
  const crlf = await call(
    CODER_TOOL.CREATE_TASK,
    { name: "Seats", plan: "\r\n# Seats\r\n\r\n## Goal\r\n\r\nBill by seat." },
    "call-crlf",
  );
  assert.ok(isRecord(crlf.task) && isWireString(crlf.task.id), JSON.stringify(crlf));
  assert.equal(
    Option.getOrThrow(await database.run(readTask(bob, crlf.task.id))).text,
    "## Goal\r\n\r\nBill by seat.",
  );

  // A line opening on # that is no Markdown title is the plan's own, and stays.
  const kept = await call(
    CODER_TOOL.CREATE_TASK,
    { name: "Limits", plan: "#define MAX 10\n\n## Goal\n\nUpdate limits." },
    "call-define",
  );
  assert.ok(isRecord(kept.task) && isWireString(kept.task.id), JSON.stringify(kept));
  assert.equal(
    Option.getOrThrow(await database.run(readTask(bob, kept.task.id))).text,
    "#define MAX 10\n\n## Goal\n\nUpdate limits.",
  );

  // The same call run again, even twice at once, answers the task it made, and makes no second.
  const again = await Promise.all([
    call(CODER_TOOL.CREATE_TASK, { name }, "call-new"),
    call(CODER_TOOL.CREATE_TASK, { name }, "call-new"),
  ]);
  assert.deepEqual(again, [made, made]);
  const racing = await Promise.all([
    call(CODER_TOOL.CREATE_TASK, { name: "Raced" }, "call-race"),
    call(CODER_TOOL.CREATE_TASK, { name: "Raced" }, "call-race"),
  ]);
  assert.ok(
    racing.every((each) => each.status === ACTION_RESULT_STATUS.ACCEPTED),
    JSON.stringify(racing),
  );
  assert.equal((await tasksNamed(bob, workspaceId, "Raced")).length, 1);
  assert.deepEqual(await tasksNamed(bob, workspaceId, name), [taskId]);
  assert.equal(tasksCounted(bob), countedBefore + 4, "each task is counted once, as Bob's");

  // A start on it by its id, as any other task of the workspace.
  const started = await call(
    CODER_TOOL.START_AGENT,
    { taskId, prompt: "Write the migration." },
    "call-start",
  );
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id), JSON.stringify(started));
  assert.equal(
    Option.getOrThrow(await database.run(readCodingAgent(bob, started.agent.id))).taskId,
    taskId,
  );

  // None names no repository, and one the installation does not reach makes nothing.
  const bare = await call(CODER_TOOL.CREATE_TASK, { name: "Bare", repository: null }, "call-bare");
  assert.ok(isRecord(bare.task), JSON.stringify(bare));
  assert.equal(bare.task.repository, null);
  assert.deepEqual(
    await call(CODER_TOOL.CREATE_TASK, { name: "Away", repository: "Acme/Elsewhere" }, "call-away"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: UPDATE_TASK_REFUSAL.NOT_REACHABLE },
  );
  assert.deepEqual(await tasksNamed(bob, workspaceId, "Away"), []);
  for (const input of [{ name: "   " }, { name: "a".repeat(TASK_BOUNDS.MAX_NAME_CHARS + 1) }, {}]) {
    assert.deepEqual(await call(CODER_TOOL.CREATE_TASK, input, "call-bad"), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: CREATE_TASK_REFUSAL.UNREADABLE,
    });
  }

  // A start that still names a new task, as starts did before create_task, is refused with where to go.
  assert.deepEqual(
    await call(CODER_TOOL.START_AGENT, { newTask: "Old way", prompt: "Sweep." }, "call-old"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.NEW_TASK },
  );
  assert.deepEqual(await tasksNamed(bob, workspaceId, "Old way"), []);
  assert.equal(eve.sent.length, 1, "a refused start starts nothing");
});

test("an agent whose starter has left the workspace makes no task in it", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.teammates, eve.services);
  await database.run(leaveWorkspace(workspaceId, agents.teammates.userId));

  const refused = await call(CODER_TOOL.CREATE_TASK, { name: "Left behind" });
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED, JSON.stringify(refused));
  assert.deepEqual(await tasksNamed(agents.caller.userId, workspaceId, "Left behind"), []);
});

test("an agent whose starter has left the workspace reaches no other agent", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const host = hostOf(true);
  const call = await peerCaller(host, agents.teammates, eve.services);
  await database.run(leaveWorkspace(workspaceId, agents.teammates.userId));

  // Its own agent is read on the same standing, so the call is refused as one that is no agent's.
  assert.deepEqual(await call(CODER_TOOL.LIST_AGENTS, {}), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODER_REFUSAL.NO_AGENT,
  });
  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.caller.id, text: NOTE }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODER_REFUSAL.NO_AGENT },
  );
  assert.equal(eve.sent.length, 0);
});

test("update_agent archives a teammate's idle agent on another task for the caller's starter, recording the calling agent and its reason, answers a call run again as done with the first record kept, and brings it back with the record cleared", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, true);
  const reason = "Its pull request merged.";
  const row = async () =>
    Option.getOrThrow(
      await database.run(readCodingAgent(agents.teammates.userId, agents.teammates.id)),
    );
  const archivedAs = (answer: WireRecord) => {
    assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(answer));
    return isRecord(answer.agent) ? answer.agent.archived : undefined;
  };
  const archive = (input: Readonly<Record<string, WireBoundaryInput>>, callId?: string) =>
    call(CODER_TOOL.UPDATE_AGENT, { agentId: agents.teammates.id, ...input }, callId);

  assert.equal(archivedAs(await archive({ archived: true, reason })), true);
  const record = {
    by: CODING_AGENT_ARCHIVER.AGENT,
    userId: agents.caller.userId,
    agentId: agents.caller.id,
    agentName: CALLER_TITLE,
    reason,
  };
  assert.ok((await row()).archivedAt !== null);
  assert.deepEqual((await row()).archivedBy, record);
  assert.equal(archivedAs(await archive({ archived: true, reason: "Again." }, "call-2")), true);
  assert.deepEqual((await row()).archivedBy, record, "a second archive keeps the first record");
  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.AGENT_ARCHIVED },
  );

  // An unarchive, here beside a rename, brings it back with the record cleared, and again is done.
  assert.equal(archivedAs(await archive({ archived: false, title: "Billing" }, "call-3")), false);
  assert.deepEqual([(await row()).archivedAt, (await row()).archivedBy], [null, null]);
  assert.equal((await row()).title, "Billing");
  assert.equal(archivedAs(await archive({ archived: false }, "call-4")), false);
});

test("update_agent archives no agent still working, nor the caller itself, an agent of another workspace its starter is also in, or a stranger's, and an archive refused writes nothing else asked beside it", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, false);
  const archive = (agentId: string, input: Readonly<Record<string, WireBoundaryInput>> = {}) =>
    call(CODER_TOOL.UPDATE_AGENT, { agentId, archived: true, ...input });
  const rejected = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });

  assert.deepEqual(
    await archive(agents.teammates.id, { title: "Renamed" }),
    rejected(UPDATE_AGENT_REFUSAL.WORKING),
  );
  assert.deepEqual(await archive(agents.caller.id), rejected(UPDATE_AGENT_REFUSAL.SELF));
  assert.deepEqual(
    await archive(agents.otherWorkspaces.id),
    rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT),
  );
  assert.deepEqual(
    await archive(agents.strangers.id),
    rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT),
  );
  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_AGENT, { agentId: agents.strangers.id, archived: false }),
    rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT),
  );
  for (const input of [
    { reason: "r".repeat(CODING_AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS + 1) },
    { archived: false, reason: "Back." },
  ]) {
    assert.deepEqual(
      await call(CODER_TOOL.UPDATE_AGENT, {
        agentId: agents.teammates.id,
        archived: true,
        ...input,
      }),
      rejected(UPDATE_AGENT_REFUSAL.UNREADABLE),
    );
  }
  for (const agent of [agents.teammates, agents.caller, agents.otherWorkspaces, agents.strangers]) {
    const read = Option.getOrThrow(await database.run(readCodingAgent(agent.userId, agent.id)));
    assert.equal(read.archivedAt, null, agent.id);
  }
  const teammates = Option.getOrThrow(
    await database.run(readCodingAgent(agents.teammates.userId, agents.teammates.id)),
  );
  assert.equal(teammates.title, null, "a refused archive renames nothing");
});

test("update_task refuses to archive a task while an agent on it still works, then archives the teammate's task for the caller's starter with its agents, as the Archive task menu does, answers a call run again as done, and brings both back", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const turnId = await turnOn(agents.teammates, false);
  const billing = Option.getOrThrow(
    await database.run(readTask(agents.teammates.userId, tasks.billing)),
  );
  const answered = (archived: boolean, already: boolean) => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
    task: {
      id: tasks.billing,
      key: `TW-${billing.task.number}`,
      status: TASK_STATUS.TODO,
      priority: TASK_PRIORITY.NONE,
      name: "Billing",
      repository: RELAY_FULL_NAME,
      archived,
      pinned: false,
      mention: `[@Billing](https://tryluke.dev/workspace-${workspaceId}/plan/${tasks.billing})`,
    },
    already,
  });
  const archivedAt = async () =>
    Option.getOrThrow(await database.run(readTask(agents.teammates.userId, tasks.billing))).task
      .archivedAt;
  const listedBy = async (userId: string) =>
    (await database.run(listTasks(userId))).map((listed) => listed.id);
  const archive = (archived: boolean, key: string) =>
    call(CODER_TOOL.UPDATE_TASK, { taskId: tasks.billing, archived }, key);

  const agentArchive = async () =>
    Option.getOrThrow(
      await database.run(readCodingAgent(agents.teammates.userId, agents.teammates.id)),
    ).archivedBy;

  assert.deepEqual(await archive(true, "call-0"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: UPDATE_TASK_REFUSAL.AGENTS_WORKING,
  });
  assert.equal(await archivedAt(), undefined, "a refused archive leaves the task standing");
  assert.equal(await agentArchive(), null, "and its agent unarchived and at work");
  const target = {
    userId: agents.teammates.userId,
    conversationId: agents.teammates.conversationId,
  };
  await database.run(
    writer.consume(target, {
      conversationId: sessionKey(target.conversationId),
      turnId,
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status: BRAIN_REQUEST_STATUS.SUCCEEDED,
      responseIds: [],
      at: NOW,
    }),
  );

  assert.deepEqual(await archive(true, "call-1"), answered(true, false));
  const stamped = await archivedAt();
  assert.ok(stamped !== undefined);
  assert.deepEqual(await agentArchive(), {
    by: CODING_AGENT_ARCHIVER.MEMBER,
    userId: agents.caller.userId,
    withTask: true,
  });
  // Every member of the workspace reads it archived, its owner among them, as after the menu's.
  assert.ok(!(await listedBy(agents.caller.userId)).includes(tasks.billing));
  assert.ok(!(await listedBy(agents.teammates.userId)).includes(tasks.billing));
  // list_tasks leaves it out unless asked, and then names it archived, so it is found to bring back.
  const listedIds = (listed: WireRecord) =>
    Array.isArray(listed.tasks)
      ? listed.tasks.flatMap((each) => (isRecord(each) ? [[each.id, each.archived]] : []))
      : [];
  assert.deepEqual(listedIds(await call(CODER_TOOL.LIST_TASKS, { nameContains: "Bill" })), []);
  assert.deepEqual(
    listedIds(await call(CODER_TOOL.LIST_TASKS, { nameContains: "Bill", includeArchived: true })),
    [[tasks.billing, true]],
  );
  assert.deepEqual(await archive(true, "call-2"), answered(true, true));
  assert.equal(await archivedAt(), stamped, "a second archive keeps the first stamp");
  // An archived task takes no new name, as the menu's rename refuses one, unless the same call brings it back.
  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_TASK, { taskId: tasks.billing, name: "Seats" }, "call-3"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: UPDATE_TASK_REFUSAL.ARCHIVED },
  );

  assert.deepEqual(await archive(false, "call-4"), answered(false, false));
  assert.equal(await archivedAt(), undefined);
  assert.ok((await listedBy(agents.teammates.userId)).includes(tasks.billing));
  assert.equal(await agentArchive(), null, "its agent comes back with it");
  assert.deepEqual(await archive(false, "call-5"), answered(false, true));
});

test("update_task renames a task, pins it for the caller's starter alone, sets its repository only where the workspace's installation reaches it and clears it, and renames the caller's own task, as the member's menu does", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const update = (changes: WireRecord, key: string) =>
    call(CODER_TOOL.UPDATE_TASK, { taskId: tasks.billing, ...changes }, key);
  const readBy = async (userId: string) =>
    Option.getOrThrow(await database.run(readTask(userId, tasks.billing))).task;

  const renamed = await update({ name: "Seat billing", pinned: true }, "call-1");
  assert.equal(renamed.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(renamed));
  assert.deepEqual(
    isRecord(renamed.task) ? [renamed.task.name, renamed.task.pinned, renamed.already] : [],
    ["Seat billing", true, false],
  );
  assert.equal((await readBy(agents.teammates.userId)).name, "Seat billing");
  assert.ok((await readBy(agents.caller.userId)).pinnedAt !== undefined);
  assert.equal((await readBy(agents.teammates.userId)).pinnedAt, undefined, "the owner's own pin");
  assert.equal(
    (await update({ name: "Seat billing", pinned: true }, "call-2")).already,
    true,
    "a change already standing answers as done",
  );

  assert.deepEqual(await update({ repository: "Acme/Elsewhere" }, "call-3"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: UPDATE_TASK_REFUSAL.NOT_REACHABLE,
  });
  assert.equal((await readBy(agents.caller.userId)).repository, RELAY_FULL_NAME);
  const cleared = await update({ repository: null }, "call-4");
  assert.equal(isRecord(cleared.task) && cleared.task.repository, null, JSON.stringify(cleared));
  const set = await update({ repository: RELAY_FULL_NAME }, "call-5");
  assert.equal(isRecord(set.task) && set.task.repository, RELAY_FULL_NAME, JSON.stringify(set));
  // The repository named in another casing is GitHub's same one, which already stands.
  const again = await update({ repository: RELAY_FULL_NAME.toLowerCase() }, "call-5b");
  assert.deepEqual(
    [isRecord(again.task) && again.task.repository, again.already],
    [RELAY_FULL_NAME, true],
    JSON.stringify(again),
  );

  const own = await call(
    CODER_TOOL.UPDATE_TASK,
    { taskId: tasks.invitations, name: "Invitations" },
    "call-6",
  );
  assert.equal(own.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(own));
});

test("update_task refuses to archive the task the caller works on, and refuses a task of another workspace its starter is also in, a stranger's, an id that names no task, and a call that names no change, changing none of them", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const strangersTask = Option.getOrThrow(
    await database.run(readCodingAgent(agents.strangers.userId, agents.strangers.id)),
  ).taskId;
  assert.ok(strangersTask !== null);
  const rejected = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });
  const archive = (taskId: string) => call(CODER_TOOL.UPDATE_TASK, { taskId, archived: true });

  assert.deepEqual(await archive(tasks.invitations), rejected(UPDATE_TASK_REFUSAL.OWN_TASK));
  assert.deepEqual(await archive(tasks.elsewhere), rejected(UPDATE_TASK_REFUSAL.NO_TASK));
  assert.deepEqual(await archive(strangersTask), rejected(UPDATE_TASK_REFUSAL.NO_TASK));
  assert.deepEqual(await archive(randomUUID()), rejected(UPDATE_TASK_REFUSAL.NO_TASK));
  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_TASK, { taskId: strangersTask, name: "Mine now" }),
    rejected(UPDATE_TASK_REFUSAL.NO_TASK),
  );
  assert.deepEqual(await archive("Billing"), rejected(UPDATE_TASK_REFUSAL.UNREADABLE));
  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_TASK, { taskId: tasks.billing }),
    rejected(UPDATE_TASK_REFUSAL.UNREADABLE),
  );
  const owners = [
    [agents.caller.userId, tasks.invitations],
    [agents.otherWorkspaces.userId, tasks.elsewhere],
    [agents.strangers.userId, strangersTask],
  ] as const;
  for (const [userId, taskId] of owners) {
    const read = Option.getOrThrow(await database.run(readTask(userId, taskId)));
    assert.equal(read.task.archivedAt, undefined, taskId);
    assert.notEqual(read.task.name, "Mine now", taskId);
  }
});

test("archive_agent refuses an agent whose turn a Stop was asked of but which still runs, since the turn goes on until eve ends it", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const target = {
    userId: agents.teammates.userId,
    conversationId: agents.teammates.conversationId,
  };
  const turnId = randomUUID();
  await database.run(
    Effect.gen(function* () {
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
      yield* writer.consume(target, {
        conversationId: sessionKey(target.conversationId),
        turnId,
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: NOW,
      });
      yield* writer.requestTurnCancel(target, { turnId, at: new Date(NOW) });
    }),
  );

  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_AGENT, { agentId: agents.teammates.id, archived: true }),
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: UPDATE_AGENT_REFUSAL.WORKING,
    },
  );
});

/** The agent as the caller's `list_agents` and `read_agent` read it: its status, and why where it failed. */
async function standingAsRead(
  call: Awaited<ReturnType<typeof peerCaller>>,
  agentId: string,
): Promise<readonly unknown[]> {
  const listed = await call(CODER_TOOL.LIST_AGENTS, {});
  const row = (Array.isArray(listed.agents) ? listed.agents : []).find(
    (agent) => isRecord(agent) && agent.id === agentId,
  );
  const read = await call(CODER_TOOL.READ_AGENT, { agentId });
  const agent = isRecord(read.agent) ? read.agent : {};
  return [
    isRecord(row) ? row.status : undefined,
    isRecord(row) ? row.failureReason : undefined,
    agent.status,
    agent.failureReason,
  ];
}

test("an agent whose session eve no longer runs reads as running until a message to it is refused as ended for good, then as failed for its session's end, which archive_agent archives and stop_agent answers as idle", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId, [], undefined, "no_active_turn", true);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, false);

  assert.deepEqual(await standingAsRead(call, agents.teammates.id), [
    CODING_AGENT_STATUS.RUNNING,
    undefined,
    CODING_AGENT_STATUS.RUNNING,
    undefined,
  ]);
  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.RETIRED },
  );
  const failed = [
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
  ];
  assert.deepEqual(await standingAsRead(call, agents.teammates.id), failed);
  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE }, "call-2"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.RETIRED },
  );
  assert.deepEqual(
    await standingAsRead(call, agents.teammates.id),
    failed,
    "a second refusal settles nothing again",
  );

  assert.deepEqual(await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id }, "call-3"), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    agent: {
      id: agents.teammates.id,
      title: OPUS,
      task: { id: tasks.billing, name: "Billing", archived: false },
      onYourTask: false,
      status: CODING_AGENT_STATUS.FAILED,
    },
    stopped: false,
  });
  assert.deepEqual(
    eve.sent.filter((sent) => sent.path.endsWith("/cancel")),
    [],
    "an idle agent's Stop asks eve nothing",
  );
  const archived = await call(
    CODER_TOOL.UPDATE_AGENT,
    { agentId: agents.teammates.id, archived: true, reason: "Its session ended." },
    "call-4",
  );
  assert.equal(archived.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(archived));
  const read = await database.run(readCodingAgent(agents.teammates.userId, agents.teammates.id));
  assert.notEqual(Option.getOrThrow(read).archivedAt, null);
});

/** A turn of the agent's that eve began and that failed on its model call, as eve ends one. */
async function failedTurnOn(agent: StartedAgent): Promise<void> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const turnId = randomUUID();
  const turn = { conversationId: sessionKey(target.conversationId), turnId };
  await database.run(
    Effect.gen(function* () {
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_1" });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: NOW + 1,
      });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        sequence: 2,
        status: BRAIN_REQUEST_STATUS.FAILED,
        failure: BRAIN_REQUEST_FAILURE.MODEL,
        responseIds: [],
        at: NOW + 2,
      });
    }),
  );
}

test("list_agents and read_agent say why each failed agent failed: a turn failed midway, a session that never started, a turn the sweep abandoned, and a failure after an earlier turn completed", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const bob = agents.teammates.userId;
  const midway = agents.teammates;
  await failedTurnOn(midway);
  const unstarted = await agentOn(bob, tasks.billing);
  await database.run(
    Effect.flatMap(Database, (db) =>
      db
        .update(codingAgent)
        .set({ createdAt: new Date(0) })
        .where(eq(codingAgent.id, unstarted.id)),
    ),
  );
  const abandoned = await agentOn(bob, tasks.billing);
  await turnOn(abandoned, false);
  await database.run(
    sweepAbandonedTurns({ writer }, { now: NOW + TURN_ABANDON.CODING_AGENT_AFTER_MS + 1 }),
  );
  const afterCompleted = await agentOn(bob, tasks.billing);
  await turnOn(afterCompleted, true);
  await failedTurnOn(afterCompleted);

  const failed = (failure: string) => [
    CODING_AGENT_STATUS.FAILED,
    failure,
    CODING_AGENT_STATUS.FAILED,
    failure,
  ];
  assert.deepEqual(await standingAsRead(call, midway.id), failed(CODING_AGENT_FAILURE.MODEL));
  assert.deepEqual(
    await standingAsRead(call, unstarted.id),
    failed(CODING_AGENT_FAILURE.NOT_STARTED),
  );
  assert.deepEqual(
    await standingAsRead(call, abandoned.id),
    failed(CODING_AGENT_FAILURE.ABANDONED),
  );
  assert.deepEqual(
    await standingAsRead(call, afterCompleted.id),
    failed(CODING_AGENT_FAILURE.MODEL),
  );
});

test("a message eve took that no turn received before the session ended keeps the agent from reading as running once a later message is refused as ended for good", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, false);
  const taken = await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE });
  assert.equal(taken.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(taken));
  eve.retire();

  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE }, "call-2"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.RETIRED },
  );
  assert.deepEqual(await standingAsRead(call, agents.teammates.id), [
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
  ]);
  const archived = await call(
    CODER_TOOL.UPDATE_AGENT,
    { agentId: agents.teammates.id, archived: true },
    "call-3",
  );
  assert.equal(archived.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(archived));
});

test("a message refused as ended for good leaves an agent whose turn had already ended as that turn ended", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId, [], undefined, "accepted", true);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, true);

  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.RETIRED },
  );
  assert.deepEqual(await standingAsRead(call, agents.teammates.id), [
    CODING_AGENT_STATUS.COMPLETED,
    undefined,
    CODING_AGENT_STATUS.COMPLETED,
    undefined,
  ]);
});

/** The coder channel's handlers of a session's end, each handing the session to the host given as eve's channel adapter would. */
function sessionEndsOf(host: CoderHost) {
  const { events } = coderChannelInput(
    async () => undefined,
    { reachesSession: async () => false, reachesConversation: async () => false },
    { secret: undefined, admits: CODER_DEPLOYMENT_TURNS, presents: DEPLOYMENT_PRESENCE.ACCOUNT },
    (sessionId) => database.run(host.sessionEnded(sessionId)),
  );
  const failed = events?.["session.failed"];
  const completed = events?.["session.completed"];
  assert.ok(failed !== undefined && completed !== undefined);
  return {
    failed: (sessionId: string) =>
      failed({ code: "WORKFLOW_EXECUTION_FAILED", message: "The run threw.", sessionId }, {}),
    completed: (agent: StartedAgent) =>
      completed(
        undefined,
        {},
        {
          session: { id: agent.sessionId, auth: seat(agent), turn: { id: "turn_0", sequence: 0 } },
          getSandbox: () => Promise.reject(new Error("no sandbox stands")),
        },
      ),
  };
}

test("an agent whose session eve says failed reads as failed for its session's end at once, a repeated end changes nothing, and an unknown session, an idle agent, and an agent whose conversation recorded a newer session are left as they stood", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const host = hostOf(true);
  const call = await peerCaller(host, agents.caller, eve.services);
  const ends = sessionEndsOf(host);
  const running = [CODING_AGENT_STATUS.RUNNING, undefined, CODING_AGENT_STATUS.RUNNING, undefined];
  const failed = [
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
  ];
  const bob = agents.teammates.userId;
  await turnOn(agents.teammates, false);
  const idle = await agentOn(bob, tasks.billing);
  await turnOn(idle, true);
  // A newer session recorded on the conversation since, whose turn is that session's own.
  const rotated = await agentOn(bob, tasks.billing);
  assert.equal(await database.run(claimRuntimeSession(rotated, sessionId(), new Date(NOW))), true);
  await turnOn(rotated, false);

  await ends.failed(sessionId());
  assert.deepEqual(await standingAsRead(call, agents.teammates.id), running);

  await ends.failed(agents.teammates.sessionId);
  assert.deepEqual(await standingAsRead(call, agents.teammates.id), failed);
  await ends.failed(agents.teammates.sessionId);
  assert.deepEqual(
    await standingAsRead(call, agents.teammates.id),
    failed,
    "a repeated end changes nothing",
  );

  await ends.failed(idle.sessionId);
  assert.deepEqual(await standingAsRead(call, idle.id), [
    CODING_AGENT_STATUS.COMPLETED,
    undefined,
    CODING_AGENT_STATUS.COMPLETED,
    undefined,
  ]);
  await ends.failed(rotated.sessionId);
  assert.deepEqual(await standingAsRead(call, rotated.id), running);
});

test("an agent whose session eve says completed while its turn still reads running reads as failed for its session's end", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const host = hostOf(true);
  const call = await peerCaller(host, agents.caller, eve.services);
  await turnOn(agents.teammates, false);

  await sessionEndsOf(host).completed(agents.teammates);
  assert.deepEqual(await standingAsRead(call, agents.teammates.id), [
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_FAILURE.SESSION_ENDED,
  ]);
});

test("an agent whose starter has left the workspace archives no agent of it", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, true);
  await database.run(leaveWorkspace(workspaceId, agents.caller.userId));

  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_AGENT, { agentId: agents.teammates.id, archived: true }),
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: CODER_REFUSAL.NO_AGENT,
    },
  );
  const read = await database.run(readCodingAgent(agents.teammates.userId, agents.teammates.id));
  assert.equal(Option.getOrThrow(read).archivedAt, null);
});

test("stop_agent stops a teammate's running agent on another task by eve's cancel of its turn, which the list then reads as cancelled, and answers a call run again as stopped with no second cancel", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, false);
  const stopped = {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    agent: {
      id: agents.teammates.id,
      title: OPUS,
      task: { id: tasks.billing, name: "Billing", archived: false },
      onYourTask: false,
      status: CODING_AGENT_STATUS.CANCELLED,
    },
    stopped: true,
  };
  const cancels = () => eve.sent.filter((sent) => sent.path.endsWith("/cancel"));

  assert.deepEqual(await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id }), stopped);
  assert.deepEqual(
    cancels().map((sent) => [sent.path, JSON.parse(sent.body)]),
    [[`/eve/coder/v1/session/${agents.teammates.sessionId}/cancel`, { turnId: "turn_0" }]],
  );
  const listed = await call(CODER_TOOL.LIST_AGENTS, { taskId: tasks.billing });
  const agentsListed = Array.isArray(listed.agents) ? listed.agents : [];
  assert.deepEqual(
    agentsListed.map((agent) => (isRecord(agent) ? [agent.id, agent.status] : [])),
    [[agents.teammates.id, CODING_AGENT_STATUS.CANCELLED]],
  );
  assert.deepEqual(
    await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id }, "call-2"),
    stopped,
  );
  assert.equal(cancels().length, 1, "a stop already standing sends eve no second cancel");
});

test("stop_agent answers an idle agent as idle and changes nothing, refuses one still starting, and stops neither the caller itself, an archived agent, an agent of another workspace its starter is also in, nor a stranger's", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const stop = (agentId: string) => call(CODER_TOOL.STOP_AGENT, { agentId });
  const rejected = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });
  await turnOn(agents.teammates, true);

  assert.deepEqual(await stop(agents.teammates.id), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    agent: {
      id: agents.teammates.id,
      title: OPUS,
      task: { id: tasks.billing, name: "Billing", archived: false },
      onYourTask: false,
      status: CODING_AGENT_STATUS.COMPLETED,
    },
    stopped: false,
  });
  const starting = await agentOn(agents.teammates.userId, tasks.billing);
  assert.deepEqual(await stop(starting.id), rejected(STOP_AGENT_REFUSAL.NOT_READY));
  assert.deepEqual(await stop(agents.caller.id), rejected(STOP_AGENT_REFUSAL.SELF));
  await turnOn(agents.archived, false);
  assert.deepEqual(await stop(agents.archived.id), rejected(STOP_AGENT_REFUSAL.ARCHIVED));
  for (const agent of [agents.otherWorkspaces, agents.strangers]) {
    await turnOn(agent, false);
    assert.deepEqual(await stop(agent.id), rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT), agent.id);
  }
  assert.deepEqual(
    await call(CODER_TOOL.STOP_AGENT, { agentId: "not-an-id" }),
    rejected(STOP_AGENT_REFUSAL.UNREADABLE),
  );
  assert.deepEqual(
    eve.sent.filter((sent) => sent.path.endsWith("/cancel")),
    [],
    "nothing was cancelled",
  );
});

test("stop_agent run again under its key after the turn it stopped ended answers as stopped and cancels nothing, so a turn a message began since runs on", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const cancels = () => eve.sent.filter((sent) => sent.path.endsWith("/cancel"));
  const first = await turnOn(agents.teammates, false);

  const stopped = await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id }, "call-1");
  assert.equal(stopped.stopped, true, JSON.stringify(stopped));
  await cancelledTurnEnds(agents.teammates, first);
  await turnOn(agents.teammates, false);

  const again = await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id }, "call-1");
  assert.equal(again.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(again));
  assert.equal(again.stopped, true);
  assert.equal(cancels().length, 1, "the call run again sends eve no cancel");
  const listed = await call(CODER_TOOL.LIST_AGENTS, { taskId: tasks.billing }, "call-2");
  const agentsListed = Array.isArray(listed.agents) ? listed.agents : [];
  assert.deepEqual(
    agentsListed.map((agent) => (isRecord(agent) ? [agent.id, agent.status] : [])),
    [[agents.teammates.id, CODING_AGENT_STATUS.RUNNING]],
    "the turn begun since runs on",
  );
});

test("stop_agent answers a turn eve says ended before its cancel as not stopped by it, and so again when the call is run again once the turn settled", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId, [], undefined, "no_active_turn");
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const turnId = await turnOn(agents.teammates, false);

  const answer = await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id }, "call-1");
  assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(answer));
  assert.equal(answer.stopped, false);
  await database.run(
    writer.consume(
      { userId: agents.teammates.userId, conversationId: agents.teammates.conversationId },
      {
        conversationId: sessionKey(agents.teammates.conversationId),
        turnId,
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        sequence: 2,
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        responseIds: [],
        at: NOW,
      },
    ),
  );
  const again = await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id }, "call-1");
  assert.equal(again.stopped, false, JSON.stringify(again));
});

test("a deployment that names no eve still answers an idle agent as idle, and refuses to stop a running one as having no service", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(false), agents.caller, eve.services);
  await turnOn(agents.teammates, true);
  const running = await agentOn(agents.teammates.userId, tasks.billing);
  await turnOn(running, false);

  const idle = await call(CODER_TOOL.STOP_AGENT, { agentId: agents.teammates.id });
  assert.deepEqual([idle.status, idle.stopped], [ACTION_RESULT_STATUS.ACCEPTED, false]);
  assert.deepEqual(await call(CODER_TOOL.STOP_AGENT, { agentId: running.id }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: STOP_AGENT_REFUSAL.NO_SERVICE,
  });
  assert.equal(eve.sent.length, 0);
});

test("read_page reads a page a teammate showed on another task of the caller's workspace, its newest version or one named, its HTML cut on a line to the bound, and nothing of another workspace's or a version never written", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const bob = agents.teammates.userId;
  const rows = Array.from({ length: 3_000 }, (_, at) => `<p>row ${at}</p>`).join("\n");
  const shown = Option.getOrThrow(
    await database.run(
      writePage(
        bob,
        tasks.billing,
        { title: "Seats", html: "<h1>One</h1>" },
        { kind: PAGE_SHOWER.LUKE },
      ),
    ),
  );
  await database.run(
    writePage(
      bob,
      tasks.billing,
      { pageId: shown.id, title: "Seats by month", html: rows },
      { kind: PAGE_SHOWER.LUKE },
    ),
  );
  const elsewhere = Option.getOrThrow(
    await database.run(
      writePage(
        agents.otherWorkspaces.userId,
        tasks.elsewhere,
        { title: "Theirs", html: "<p/>" },
        { kind: PAGE_SHOWER.LUKE },
      ),
    ),
  );
  const page = (answer: WireRecord) => (isRecord(answer.page) ? answer.page : {});

  const newest = await call(CODER_TOOL.READ_PAGE, { pageId: shown.id });
  assert.equal(newest.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(newest));
  const read = page(newest);
  assert.deepEqual(
    [read.title, read.version, read.newestVersion, read.task, read.isYourTask],
    ["Seats by month", 2, 2, { id: tasks.billing, name: "Billing" }, false],
  );
  assert.ok(
    isWireString(read.mention) &&
      read.mention.startsWith("[@Seats by month](") &&
      read.mention.endsWith(`/plan/${tasks.billing}/page/${shown.id})`),
    String(read.mention),
  );
  assert.ok(isWireString(read.html) && read.html.length <= 40_000 && read.html.endsWith("</p>"));
  assert.equal(
    (isWireString(read.html) ? read.html.length : 0) + Number(read.leftOutChars),
    rows.length,
  );
  const first = page(await call(CODER_TOOL.READ_PAGE, { pageId: shown.id, version: 1 }));
  assert.deepEqual([first.version, first.html, first.leftOutChars], [1, "<h1>One</h1>", 0]);

  const refused = { status: ACTION_RESULT_STATUS.REJECTED, reason: READ_PAGE_REFUSAL.NO_PAGE };
  assert.deepEqual(await call(CODER_TOOL.READ_PAGE, { pageId: shown.id, version: 3 }), refused);
  // The caller's starter is a member of the other workspace too, but the caller is not of it.
  assert.deepEqual(await call(CODER_TOOL.READ_PAGE, { pageId: elsewhere.id }), refused);
  assert.deepEqual(await call(CODER_TOOL.READ_PAGE, { pageId: shown.id, version: 0 }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: READ_PAGE_REFUSAL.UNREADABLE,
  });
});

test("create_section, update_task's sectionId, and delete_section keep the caller's starter's own sidebar sections of its workspace, as list_tasks then names them and the Mac reads them, once under the call's key, and reach no section or task of another workspace", async () => {
  const { workspaceId, elsewhere, plans: taskIds, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const sectionsOf = async (userId: string, inWorkspace: string) => {
    const kept = await database.run(listTaskSections(userId));
    const sections = kept.sections.filter((section) => section.workspaceId === inWorkspace);
    const ids = new Set(sections.map((section) => section.id));
    return { sections, entries: kept.entries.filter((entry) => ids.has(entry.sectionId)) };
  };

  const made = await call(CODER_TOOL.CREATE_SECTION, { title: " Growth ", emoji: "🚀" }, "call-1");
  assert.equal(made.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(made));
  assert.ok(isRecord(made.section) && isWireString(made.section.id));
  const growth = made.section.id;
  assert.equal(made.section.title, "Growth");
  // The same call run again names the section it made, as it was made, and makes no second one.
  assert.deepEqual(await call(CODER_TOOL.CREATE_SECTION, { title: "Billing" }, "call-1"), made);
  const kept = await sectionsOf(caller.userId, workspaceId);
  assert.deepEqual(
    kept.sections.map((section) => [section.id, section.title, section.icon]),
    [[growth, "Growth", { kind: "emoji", emoji: "🚀" }]],
  );
  assert.deepEqual(await call(CODER_TOOL.CREATE_SECTION, { title: "  " }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: TASK_SECTION_TOOL_REFUSAL.UNREADABLE_CREATE,
  });

  // A teammate's task moves into it, which list_tasks then names, and the teammate's own sidebar wears nothing.
  const move = (taskId: string, sectionId: string | null, callId?: string) =>
    call(CODER_TOOL.UPDATE_TASK, { taskId, sectionId }, callId);
  const moved = await move(taskIds.billing, growth);
  assert.equal(moved.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(moved));
  assert.ok(isRecord(moved.task));
  assert.deepEqual(
    [moved.task.name, moved.task.section, moved.already],
    ["Billing", { id: growth, title: "Growth" }, false],
  );
  // A move to where it already stands is done.
  assert.equal((await move(taskIds.billing, growth, "call-again")).already, true);
  const listed = await call(CODER_TOOL.LIST_TASKS, {});
  assert.deepEqual(listed.sections, [{ id: growth, title: "Growth" }]);
  assert.ok(Array.isArray(listed.tasks));
  assert.deepEqual(
    Object.fromEntries(
      listed.tasks.flatMap((task) => (isRecord(task) ? [[task.id, task.sectionId]] : [])),
    ),
    { [taskIds.billing]: growth, [taskIds.invitations]: null },
  );
  assert.deepEqual((await sectionsOf(teammates.userId, workspaceId)).sections, []);

  // A section or a task of another workspace the starter is also in is none of the caller's.
  const theirs = randomUUID();
  const madeElsewhere = await database.run(
    writeTaskSections(caller.userId, {
      kind: TASK_SECTION_WRITE.CREATE,
      id: theirs,
      workspaceId: elsewhere,
      title: "Elsewhere",
    }),
  );
  assert.ok(Option.isSome(madeElsewhere));
  assert.deepEqual(await move(taskIds.invitations, theirs), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: UPDATE_TASK_REFUSAL.NO_SECTION,
  });
  assert.deepEqual(await move(taskIds.elsewhere, growth), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: UPDATE_TASK_REFUSAL.NO_TASK,
  });
  assert.deepEqual(await call(CODER_TOOL.DELETE_SECTION, { sectionId: theirs }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: TASK_SECTION_TOOL_REFUSAL.NO_SECTION,
  });
  assert.deepEqual((await call(CODER_TOOL.LIST_TASKS, {})).sections, [
    { id: growth, title: "Growth" },
  ]);
  assert.equal((await sectionsOf(caller.userId, elsewhere)).sections.length, 1);

  // Moved out under null, it stands under Tasks again; moved back in beside a rename, a delete puts it there too.
  const out = await move(taskIds.billing, null);
  assert.equal(isRecord(out.task) && out.task.section, null, JSON.stringify(out));
  assert.deepEqual((await sectionsOf(caller.userId, workspaceId)).entries, []);
  const both = await call(CODER_TOOL.UPDATE_TASK, {
    taskId: taskIds.billing,
    name: "Billing v2",
    sectionId: growth,
  });
  assert.equal(both.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(both));
  // An archived task takes no section, unless the same call brings it back.
  await database.run(updateTask(teammates.userId, taskIds.invitations, { archived: true }));
  assert.deepEqual(await move(taskIds.invitations, growth), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: UPDATE_TASK_REFUSAL.ARCHIVED,
  });
  const back = await call(CODER_TOOL.UPDATE_TASK, {
    taskId: taskIds.invitations,
    archived: false,
    sectionId: growth,
  });
  assert.equal(back.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(back));
  await move(taskIds.invitations, null, "call-out");
  assert.deepEqual(await call(CODER_TOOL.DELETE_SECTION, { sectionId: growth }), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    section: { id: growth, title: "Growth" },
    tasksBackUnderTasks: 1,
  });
  assert.deepEqual(await sectionsOf(caller.userId, workspaceId), { sections: [], entries: [] });
  const stillThere = await database.run(readTask(teammates.userId, taskIds.billing));
  assert.ok(Option.isSome(stillThere), "deleting a section deletes none of its tasks");
  assert.deepEqual(await call(CODER_TOOL.DELETE_SECTION, { sectionId: growth }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: TASK_SECTION_TOOL_REFUSAL.NO_SECTION,
  });
});

test("update_agent renames a teammate's agent, moves it to a model the catalog offers as the catalog reads the choice, and switches its servers, pins an agent on no task, refuses a pin on a task's agent and a model the catalog refuses with nothing written, and changes no agent of another workspace", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const { caller, teammates, otherWorkspaces } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const offered: readonly OfferedModel[] = [
    ...CATALOG,
    { id: SOL, name: "GPT-6.1 Sol", provider: MODEL_PROVIDER.OPENAI, efforts: ["low", "high"] },
  ];
  const call = await peerCaller(hostOf(true), caller, eve.services, modelCatalogOf(offered));
  const stored = async () =>
    Option.getOrThrow(await database.run(readCodingAgent(teammates.userId, teammates.id)));

  const changed = await call(CODER_TOOL.UPDATE_AGENT, {
    agentId: teammates.id,
    title: " Billing export ",
    model: SOL,
    effort: "low",
    contextWindow: "standard",
    disabledServers: ["notion"],
  });
  assert.equal(changed.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(changed));
  assert.ok(isRecord(changed.agent));
  assert.deepEqual(
    [changed.agent.title, changed.agent.model, changed.agent.modelName, changed.agent.effort],
    ["Billing export", SOL, "GPT-6.1 Sol", "low"],
  );
  // A model with one window keeps its whole one, as the catalog reads the choice.
  const after = await stored();
  assert.deepEqual(
    [after.title, after.model, after.effort, after.contextWindow, after.disabledServers],
    ["Billing export", SOL, "low", "long", ["notion"]],
  );

  // A pin stands only on an agent with no task; one asked of a task's agent writes nothing asked beside it.
  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_AGENT, { agentId: teammates.id, title: "Pinned", pinned: true }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: UPDATE_AGENT_REFUSAL.PIN_ON_TASK },
  );
  assert.equal((await stored()).title, "Billing export");
  const sweeper = await tasklessAgentOn(caller.userId, workspaceId);
  const pinned = await call(CODER_TOOL.UPDATE_AGENT, { agentId: sweeper.id, pinned: true });
  assert.equal(isRecord(pinned.agent) && pinned.agent.pinned, true, JSON.stringify(pinned));

  // A refused model is said with the choices, and nothing else asked beside it is written.
  const refused = await call(CODER_TOOL.UPDATE_AGENT, {
    agentId: teammates.id,
    title: "Not this",
    model: OPUS_FAST,
    effort: "high",
  });
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.ok(
    String(refused.reason).startsWith("Not changed: no offered model is"),
    String(refused.reason),
  );
  assert.ok(String(refused.reason).includes(`${SOL} (low, high)`), String(refused.reason));
  assert.equal((await stored()).title, "Billing export");

  // An empty title clears it, so the tab falls back to the model's name.
  const cleared = await call(CODER_TOOL.UPDATE_AGENT, { agentId: teammates.id, title: "" });
  assert.equal(isRecord(cleared.agent) && cleared.agent.title, SOL);
  assert.equal((await stored()).title, null);

  for (const input of [
    { agentId: teammates.id },
    { agentId: teammates.id, model: SOL },
    { agentId: teammates.id, contextWindow: "long" },
    { agentId: "not-an-id", title: "x" },
  ]) {
    assert.deepEqual(await call(CODER_TOOL.UPDATE_AGENT, input), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: UPDATE_AGENT_REFUSAL.UNREADABLE,
    });
  }
  assert.deepEqual(
    await call(CODER_TOOL.UPDATE_AGENT, { agentId: otherWorkspaces.id, title: "x" }),
    {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: CODING_AGENT_TOOL_REFUSAL.NO_AGENT,
    },
  );
  const theirs = Option.getOrThrow(
    await database.run(readCodingAgent(otherWorkspaces.userId, otherWorkspaces.id)),
  );
  assert.equal(theirs.title, null);
});

test("read_task reads a teammate's task of the caller's workspace with its plan as saved, an archived one too, cuts a long plan on a line, and reads no task of another workspace", async () => {
  const { workspaceId, plans: taskIds, agents } = await openWorkspaces();
  const { caller, teammates } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const plan = "# Billing\n\nCharge by seat.";
  assert.ok(
    Option.isSome(await database.run(savePlanText(teammates.userId, taskIds.billing, plan))),
  );

  const home = `https://tryluke.dev/workspace-${workspaceId}/plan`;
  const read = await call(CODER_TOOL.READ_TASK, { taskId: taskIds.billing });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(read));
  assert.ok(isRecord(read.task) && isRecord(read.plan));
  assert.deepEqual(
    [read.task.name, read.task.archived, read.task.isYourTask, read.task.mention],
    ["Billing", false, false, `[@Billing](${home}/${taskIds.billing})`],
  );
  assert.deepEqual(read.plan, { text: plan, saved: true, leftOutChars: 0 });
  const own = await call(CODER_TOOL.READ_TASK, { taskId: taskIds.invitations });
  assert.equal(isRecord(own.task) && own.task.isYourTask, true, JSON.stringify(own));

  // A plan past the bound is cut on a line, and what was left out is counted.
  const line = `${"x".repeat(999)}\n`;
  const long = line.repeat(41);
  await database.run(savePlanText(teammates.userId, taskIds.billing, long));
  const cut = await call(CODER_TOOL.READ_TASK, { taskId: taskIds.billing });
  assert.ok(isRecord(cut.plan) && isWireString(cut.plan.text), JSON.stringify(cut).slice(0, 200));
  assert.equal(cut.plan.text, line.repeat(40).slice(0, -1));
  assert.equal(cut.plan.leftOutChars, long.length - (line.length * 40 - 1));

  await database.run(updateTask(teammates.userId, taskIds.billing, { archived: true }));
  const archived = await call(CODER_TOOL.READ_TASK, { taskId: taskIds.billing });
  assert.equal(isRecord(archived.task) && archived.task.archived, true, JSON.stringify(archived));

  const linearIssue = {
    identifier: "REL-7",
    title: "Seat pricing",
    url: "https://linear.app/acme/issue/REL-7",
    description: "Charge per active seat.",
  };
  const fromLinear = await database.run(
    createTask(teammates.userId, {
      organizationId: workspaceId,
      name: "Seats",
      issueLinks: [linearIssueLink(linearIssue)],
    }),
  );
  const linear = await call(CODER_TOOL.READ_TASK, { taskId: fromLinear.id });
  assert.deepEqual(isRecord(linear.task) && linear.task.issues, [
    {
      provider: TASK_ISSUE_PROVIDER.LINEAR,
      key: linearIssue.identifier,
      title: linearIssue.title,
      url: linearIssue.url,
      relation: TASK_ISSUE_RELATION.CLOSES,
      description: linearIssue.description,
    },
  ]);

  // A task started from a brief, its plan still untouched, is read with the developer's words.
  const briefed = await database.run(
    createTask(teammates.userId, {
      organizationId: workspaceId,
      name: "Bulk invites",
      brief: "Allow admins to bulk invite members.",
    }),
  );
  const withBrief = await call(CODER_TOOL.READ_TASK, { taskId: briefed.id });
  assert.equal(
    isRecord(withBrief.task) && withBrief.task.brief,
    "Allow admins to bulk invite members.",
  );
  assert.equal(isRecord(linear.task) && linear.task.brief, null);

  for (const taskId of [taskIds.elsewhere, randomUUID()]) {
    assert.deepEqual(await call(CODER_TOOL.READ_TASK, { taskId }), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: READ_TASK_REFUSAL.NO_TASK,
    });
  }
  assert.deepEqual(await call(CODER_TOOL.READ_TASK, { taskId: "not-an-id" }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: READ_TASK_REFUSAL.UNREADABLE,
  });
});

test("create_task, update_task, list_tasks, and read_task carry a task's status, priority, and key, list_tasks narrows by status, and an unknown status is refused", async () => {
  const { workspaceId, plans: taskIds, agents } = await openWorkspaces();
  const { caller } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const taskOf = (answer: WireRecord) =>
    isRecord(answer.task) ? answer.task : assert.fail(JSON.stringify(answer));
  const listedIds = async (input: WireBoundaryInput) => {
    const listed = await call(CODER_TOOL.LIST_TASKS, input);
    assert.ok(Array.isArray(listed.tasks), JSON.stringify(listed));
    return listed.tasks.map((each) => (isRecord(each) ? each.id : undefined));
  };

  const filed = taskOf(
    await call(
      CODER_TOOL.CREATE_TASK,
      { name: "Refund export", status: TASK_STATUS.BACKLOG, priority: TASK_PRIORITY.HIGH },
      "call-filed",
    ),
  );
  assert.ok(isWireString(filed.id) && isWireString(filed.key), JSON.stringify(filed));
  assert.match(filed.key, /^TW-\d+$/u);
  assert.deepEqual([filed.status, filed.priority], [TASK_STATUS.BACKLOG, TASK_PRIORITY.HIGH]);
  const stored = Option.getOrThrow(await database.run(readTask(caller.userId, filed.id)));
  assert.deepEqual(
    [stored.task.status, stored.task.priority, `TW-${stored.task.number}`],
    [TASK_STATUS.BACKLOG, TASK_PRIORITY.HIGH, filed.key],
  );

  assert.deepEqual(await listedIds({ status: TASK_STATUS.BACKLOG }), [filed.id]);
  const listed = await call(CODER_TOOL.LIST_TASKS, { nameContains: "Billing" });
  assert.ok(Array.isArray(listed.tasks) && isRecord(listed.tasks[0]), JSON.stringify(listed));
  assert.deepEqual(
    [listed.tasks[0].id, listed.tasks[0].status, listed.tasks[0].priority],
    [taskIds.billing, TASK_STATUS.TODO, TASK_PRIORITY.NONE],
  );
  assert.match(String(listed.tasks[0].key), /^TW-\d+$/u);

  const changed = await call(
    CODER_TOOL.UPDATE_TASK,
    { taskId: filed.id, status: TASK_STATUS.DONE, priority: TASK_PRIORITY.LOW },
    "call-done",
  );
  assert.equal(changed.already, false, JSON.stringify(changed));
  assert.deepEqual(
    [taskOf(changed).status, taskOf(changed).priority, taskOf(changed).key],
    [TASK_STATUS.DONE, TASK_PRIORITY.LOW, filed.key],
  );
  const again = await call(
    CODER_TOOL.UPDATE_TASK,
    { taskId: filed.id, status: TASK_STATUS.DONE },
    "call-again",
  );
  assert.equal(again.already, true, JSON.stringify(again));
  assert.deepEqual(await listedIds({ status: TASK_STATUS.BACKLOG }), []);

  const read = taskOf(await call(CODER_TOOL.READ_TASK, { taskId: filed.id }));
  assert.deepEqual(
    [read.key, read.status, read.priority],
    [filed.key, TASK_STATUS.DONE, TASK_PRIORITY.LOW],
  );

  assert.deepEqual(await call(CODER_TOOL.UPDATE_TASK, { taskId: filed.id, status: "started" }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: UPDATE_TASK_REFUSAL.UNREADABLE,
  });
  assert.deepEqual(await call(CODER_TOOL.LIST_TASKS, { status: "started" }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODING_AGENT_TOOL_REFUSAL.UNREADABLE_TASKS,
  });
  assert.deepEqual(
    await call(CODER_TOOL.CREATE_TASK, { name: "Odd", priority: "p0" }, "call-odd"),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CREATE_TASK_REFUSAL.UNREADABLE },
  );
});
