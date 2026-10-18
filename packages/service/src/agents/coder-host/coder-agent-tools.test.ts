import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
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
import { createTask, listTasks, readTask } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { task } from "@luke/database/schemas/task";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  joinWorkspace,
  leaveWorkspace,
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
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { FAST_ACCESS } from "@luke/features/provider-key-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
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
import { LINK_OUTCOME } from "../../github/github-installations.js";
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
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import { DEPLOYMENT_PRESENCE } from "../brain-host/auth.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { claimRuntimeSession } from "../brain-host/conversation.js";
import {
  ARCHIVE_AGENT_REFUSAL,
  CODING_AGENT_TOOL_REFUSAL,
  LIST_MODELS_REFUSAL,
  READ_PAGE_REFUSAL,
  START_CODING_AGENT_REFUSAL,
  STOP_AGENT_REFUSAL,
} from "../coding-agent-tools.js";
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

/** A caller of the agent tools from the agent's own session, under the host given, over the suite's catalog unless another is given. */
async function peerCaller(
  host: CoderHost,
  agent: StartedAgent,
  services: Awaited<ReturnType<typeof fakeCoderEve>>["services"],
  catalog: Layer.Layer<ModelCatalog> = modelCatalogOf(CATALOG),
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
        .pipe(Effect.provide(Layer.merge(services, catalog))),
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

test("start_agent continues a teammate's agent that ended, on that agent's own task when none is named, handed its transcript and named after it; a second continue is refused naming the first, and the same call run again answers the agent it made", async () => {
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

  const second = await call(CODER_TOOL.START_AGENT, { from }, "call-continue-again");
  assert.equal(second.status, ACTION_RESULT_STATUS.REJECTED);
  assert.ok(isWireString(second.reason));
  assert.ok(second.reason.includes(stored.id), second.reason);
  assert.ok(
    second.reason.includes(
      `[@Invoice export (continued)](https://tryluke.dev/workspace-${workspaceId}/plan/${tasks.billing}/agent/${stored.id})`,
    ),
    second.reason,
  );
  assert.equal(
    eve.sent.filter((each) => each.path === "/eve/coder/v1/session").length,
    openings,
    "neither the call run again nor a second continue opens a session",
  );
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
  await refused({ from: { agentId: teammates.id }, newTask: "Invoices" }, R.FROM_WITH_PROMPT);
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

/** The ids of the tasks of the workspace the account reads under the name, newest first. */
async function tasksNamed(userId: string, workspaceId: string, name: string): Promise<string[]> {
  const listed = await database.run(listTasks(userId));
  return listed
    .filter((each) => each.workspaceId === workspaceId && each.name === name)
    .map((each) => each.id);
}

test("start_agent makes the new task it names in the caller's workspace, owned by the member the agent acts for and on the repository it works in, and starts on it; the same call run again makes no second task, a start that fails leaves none, and a newTask beside a taskId, a blank name, or one too long is refused", async () => {
  const { workspaceId, elsewhere, plans: tasks, agents } = await openWorkspaces();
  // Bob's agent on Alice's task: the task it makes is Bob's, not the owner's of the task it works on.
  const bob = agents.teammates.userId;
  const caller = await agentOn(bob, tasks.invitations);
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);
  const name = "Invite expiry migration";
  const prompt = "Write the migration that adds the invitation's expiry.";

  const started = await call(CODER_TOOL.START_AGENT, { newTask: ` ${name} `, prompt }, "call-new");
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id));
  assert.ok(isRecord(started.newTask) && isWireString(started.newTask.id), JSON.stringify(started));
  const taskId = started.newTask.id;
  assert.deepEqual(started.newTask, {
    id: taskId,
    name,
    mention: `[@${name}](https://tryluke.dev/workspace-${workspaceId}/plan/${taskId})`,
  });
  assert.equal(started.agent.onYourTask, false);
  const made = Option.getOrThrow(await database.run(readTask(bob, taskId)));
  assert.deepEqual(
    [made.ownerId, made.task.workspaceId, made.task.repository, made.task.name, made.text],
    [bob, workspaceId, RELAY_FULL_NAME, name, ""],
  );
  const agent = Option.getOrThrow(await database.run(readCodingAgent(bob, started.agent.id)));
  assert.equal(agent.taskId, taskId);
  assert.equal(eve.sent.length, 1);
  assert.ok(JSON.parse(eve.sent[0]?.body ?? "").message.startsWith(prompt));
  // It stands in the workspace's list as any task does, for a teammate too, and in no other workspace.
  const alice = agents.caller.userId;
  assert.deepEqual(await tasksNamed(alice, workspaceId, name), [taskId]);
  assert.deepEqual(await tasksNamed(alice, elsewhere, name), []);

  // The same call run again answers the agent and task it made, and makes neither again.
  const again = await call(CODER_TOOL.START_AGENT, { newTask: name, prompt }, "call-new");
  assert.ok(isRecord(again.agent) && isRecord(again.newTask), JSON.stringify(again));
  assert.equal(again.agent.id, started.agent.id);
  assert.deepEqual(again.newTask, started.newTask);
  assert.equal(eve.sent.length, 1);
  assert.deepEqual(await tasksNamed(bob, workspaceId, name), [taskId]);

  // A start the catalog refuses takes away the task made for it.
  const refused = await call(
    CODER_TOOL.START_AGENT,
    { newTask: "Refused", prompt, model: OPUS, effort: "none" },
    "call-refused",
  );
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED, JSON.stringify(refused));
  assert.deepEqual(await tasksNamed(bob, workspaceId, "Refused"), []);

  for (const input of [
    { newTask: "Both", taskId: tasks.billing, prompt },
    { newTask: "   ", prompt },
    { newTask: "a".repeat(TASK_BOUNDS.MAX_NAME_CHARS + 1), prompt },
  ]) {
    assert.deepEqual(await call(CODER_TOOL.START_AGENT, input, "call-bad"), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: START_CODING_AGENT_REFUSAL.UNREADABLE,
    });
  }
  assert.deepEqual(await tasksNamed(bob, workspaceId, "Both"), []);
  assert.equal(eve.sent.length, 1, "a refused start starts nothing");
});

test("start_agent run twice at once under one call's key keeps one new task: the run that finds the other's agent takes away the task it made and answers that agent with its own task", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const { caller } = agents;
  const name = "Invite expiry migration";
  const prompt = "Write the migration that adds the invitation's expiry.";
  // The other run lands its agent, on a task of its own, while this run confirms its repository.
  let racing = false;
  let raced: { readonly agentId: string; readonly taskId: string } | undefined;
  const eve = await fakeCoderEve(workspaceId, [], async () => {
    if (!racing) return;
    racing = false;
    const theirs = await database.run(
      createTask(caller.userId, {
        organizationId: workspaceId,
        name,
        repository: RELAY_FULL_NAME,
        planning: false,
      }),
    );
    const agent = await claimed(caller.userId, {
      ...AGENT_CHOICE,
      idempotencyKey: "call-race",
      taskId: theirs.id,
      planSnapshot: null,
      prompt,
    });
    raced = { agentId: agent.id, taskId: theirs.id };
  });
  const call = await peerCaller(hostOf(true), caller, eve.services);

  racing = true;
  const answered = await call(CODER_TOOL.START_AGENT, { newTask: name, prompt }, "call-race");
  assert.ok(raced !== undefined, "the other run landed while this one ran");
  assert.equal(answered.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(answered));
  assert.ok(isRecord(answered.agent) && isRecord(answered.newTask), JSON.stringify(answered));
  assert.equal(answered.agent.id, raced.agentId);
  assert.equal(answered.newTask.id, raced.taskId);
  assert.deepEqual(await tasksNamed(caller.userId, workspaceId, name), [raced.taskId]);
  assert.equal(eve.sent.length, 0, "no second agent's session is opened");
});

test("an agent whose starter has left the workspace makes no task in it", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.teammates, eve.services);
  await database.run(leaveWorkspace(workspaceId, agents.teammates.userId));

  const refused = await call(CODER_TOOL.START_AGENT, { newTask: "Left behind", prompt: "Sweep." });
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED, JSON.stringify(refused));
  assert.deepEqual(await tasksNamed(agents.caller.userId, workspaceId, "Left behind"), []);
  assert.equal(eve.sent.length, 0);
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

test("archive_agent archives a teammate's idle agent on another task for the caller's starter, recording the calling agent and its reason, answers a call run again as done with the first record kept, and unarchive_agent brings it back with the record cleared", async () => {
  const { workspaceId, plans: tasks, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, true);
  const reason = "Its pull request merged.";
  const row = async () =>
    Option.getOrThrow(
      await database.run(readCodingAgent(agents.teammates.userId, agents.teammates.id)),
    );
  const answered = (archived: boolean, already: boolean) => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
    agent: {
      id: agents.teammates.id,
      title: OPUS,
      model: OPUS,
      task: { id: tasks.billing, name: "Billing", archived: false },
      onYourTask: false,
    },
    archived,
    already,
  });

  assert.deepEqual(
    await call(CODER_TOOL.ARCHIVE_AGENT, { agentId: agents.teammates.id, reason }),
    answered(true, false),
  );
  const record = {
    by: CODING_AGENT_ARCHIVER.AGENT,
    userId: agents.caller.userId,
    agentId: agents.caller.id,
    agentName: CALLER_TITLE,
    reason,
  };
  assert.ok((await row()).archivedAt !== null);
  assert.deepEqual((await row()).archivedBy, record);
  assert.deepEqual(
    await call(
      CODER_TOOL.ARCHIVE_AGENT,
      { agentId: agents.teammates.id, reason: "Again." },
      "call-2",
    ),
    answered(true, true),
  );
  assert.deepEqual((await row()).archivedBy, record, "a second archive keeps the first record");
  assert.deepEqual(
    await call(CODER_TOOL.MESSAGE_AGENT, { agentId: agents.teammates.id, text: NOTE }),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: CODING_AGENT_TOOL_REFUSAL.AGENT_ARCHIVED },
  );

  assert.deepEqual(
    await call(CODER_TOOL.UNARCHIVE_AGENT, { agentId: agents.teammates.id }),
    answered(false, false),
  );
  assert.deepEqual([(await row()).archivedAt, (await row()).archivedBy], [null, null]);
  assert.deepEqual(
    await call(CODER_TOOL.UNARCHIVE_AGENT, { agentId: agents.teammates.id }),
    answered(false, true),
  );
});

test("archive_agent refuses an agent still working, the caller itself, an agent of another workspace its starter is also in, and a stranger's, archiving none of them", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  await turnOn(agents.teammates, false);
  const archive = (agentId: string) => call(CODER_TOOL.ARCHIVE_AGENT, { agentId });
  const rejected = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });

  assert.deepEqual(await archive(agents.teammates.id), rejected(ARCHIVE_AGENT_REFUSAL.WORKING));
  assert.deepEqual(await archive(agents.caller.id), rejected(ARCHIVE_AGENT_REFUSAL.SELF));
  assert.deepEqual(
    await archive(agents.otherWorkspaces.id),
    rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT),
  );
  assert.deepEqual(
    await archive(agents.strangers.id),
    rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT),
  );
  assert.deepEqual(
    await call(CODER_TOOL.UNARCHIVE_AGENT, { agentId: agents.strangers.id }),
    rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT),
  );
  assert.deepEqual(
    await call(CODER_TOOL.ARCHIVE_AGENT, {
      agentId: agents.teammates.id,
      reason: "r".repeat(CODING_AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS + 1),
    }),
    rejected(ARCHIVE_AGENT_REFUSAL.UNREADABLE),
  );
  for (const agent of [agents.teammates, agents.caller, agents.otherWorkspaces, agents.strangers]) {
    const read = Option.getOrThrow(await database.run(readCodingAgent(agent.userId, agent.id)));
    assert.equal(read.archivedAt, null, agent.id);
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

  assert.deepEqual(await call(CODER_TOOL.ARCHIVE_AGENT, { agentId: agents.teammates.id }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ARCHIVE_AGENT_REFUSAL.WORKING,
  });
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
    CODER_TOOL.ARCHIVE_AGENT,
    { agentId: agents.teammates.id, reason: "Its session ended." },
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
  const archived = await call(CODER_TOOL.ARCHIVE_AGENT, { agentId: agents.teammates.id }, "call-3");
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
  const { workspaceId, plans, agents } = await openWorkspaces();
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
  const idle = await agentOn(bob, plans.billing);
  await turnOn(idle, true);
  // A newer session recorded on the conversation since, whose turn is that session's own.
  const rotated = await agentOn(bob, plans.billing);
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

  assert.deepEqual(await call(CODER_TOOL.ARCHIVE_AGENT, { agentId: agents.teammates.id }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: CODER_REFUSAL.NO_AGENT,
  });
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
