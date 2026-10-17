import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
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
import { createTask } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { task } from "@luke/database/schemas/plan";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  joinWorkspace,
  leaveWorkspace,
  openHostedStoreTestDatabase,
  openWorkspace,
  startTask,
} from "@luke/database/testing";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
} from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
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
  type WireRecord,
} from "../../core.js";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import { modelCatalogOf, type OfferedModel } from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
} from "../../testing/github-app-fake.js";
import { sandboxDouble } from "../../testing/repository-sandbox.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { claimRuntimeSession } from "../brain-host/conversation.js";
import {
  ARCHIVE_AGENT_REFUSAL,
  CODING_AGENT_TOOL_REFUSAL,
  READ_PAGE_REFUSAL,
  START_CODING_AGENT_REFUSAL,
} from "../coding-agent-tools.js";
import { AGENT_LIST_FILTER_REFUSAL } from "../workspace-agents.js";
import { CODER_REFUSAL } from "./bounds.js";
import { type AgentToolCall, type CoderHost, coderHost } from "./host.js";
import type { CoderHostSeams } from "./production.js";
import { START_NOTE_HEADING } from "./start.js";
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
 * another workspace are not archived. Synthetic accounts, plans, and words
 * throughout.
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

/** The host over the suite's store, acting at eve's door as the deployment where `acting` says. */
function hostOf(acting: boolean): CoderHost {
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
async function agentOn(userId: string, planId: string): Promise<StartedAgent> {
  return claimed(userId, {
    ...AGENT_CHOICE,
    idempotencyKey: randomUUID(),
    taskId: planId,
    planSnapshot: "# Teammate invitations",
    prompt: null,
  });
}

/** An agent started by the account in the workspace on no task, as an automation's run starts one, its session recorded. */
async function planlessAgentOn(userId: string, workspaceId: string): Promise<StartedAgent> {
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
 * every message to a session answered taken, and each written down.
 */
async function fakeCoderEve(workspaceId: string, branches: readonly string[] = []) {
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
  const github = githubReaching([installation], undefined, undefined, (request) => {
    const { pathname } = new URL(request.url);
    // The repository holds the branches given, each at a commit; any other is GitHub's not found.
    const ref = pathname.slice(`/repos/${RELAY_FULL_NAME}/git/ref/heads/`.length);
    if (pathname.startsWith(`/repos/${RELAY_FULL_NAME}/git/ref/heads/`) && branches.includes(ref)) {
      return Response.json({ object: { type: "commit", sha: BRANCH_COMMIT } });
    }
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

/** A caller of the agent tools from the agent's own session, under the host given. */
async function peerCaller(
  host: CoderHost,
  agent: StartedAgent,
  services: Awaited<ReturnType<typeof fakeCoderEve>>["services"],
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
        .pipe(Effect.provide(Layer.merge(services, modelCatalogOf(CATALOG)))),
    );
}

/** A turn of the agent's, begun as eve begins one and ended where `ended` says, so the agent reads as working or as idle. */
async function turnOn(agent: StartedAgent, ended: boolean): Promise<void> {
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
  const elsewherePlan = await database.run(
    createTask(carol, {
      organizationId: elsewhere,
      name: "Elsewhere",
      repository: RELAY_FULL_NAME,
    }),
  );
  const otherWorkspaces = await agentOn(carol, elsewherePlan.id);

  const stranger = await database.createUser();
  const strangersPlan = await database.run(
    startTask(stranger, { name: "Stranger's plan", repository: RELAY_FULL_NAME }),
  );
  const strangers = await agentOn(stranger, strangersPlan.id);
  return {
    workspaceId,
    elsewhere,
    plans: { invitations: invitations.id, billing: billing.id, elsewhere: elsewherePlan.id },
    agents: { caller, teammates, archived, otherWorkspaces, strangers },
  };
}

test("list_agents names every other agent of the caller's workspace, on any task and by any member, each with its task and the mention it is named by, archived ones marked, and none of another workspace's; it narrows to one task by its id or to the caller's own", async () => {
  const { workspaceId, plans, agents } = await openWorkspaces();
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
    task: { id: plans.invitations, name: "Teammate invitations", archived: false },
    onYourTask: true,
    archived: true,
    mention: `[@${OPUS}](https://tryluke.dev/workspace-${workspaceId}/plan/${plans.invitations}/agent/${agents.archived.id})`,
  };
  const teammates = {
    ...reading,
    id: agents.teammates.id,
    status: CODING_AGENT_STATUS.STARTING,
    repository: RELAY_FULL_NAME,
    branch: null,
    task: { id: plans.billing, name: "Billing", archived: false },
    onYourTask: false,
    archived: false,
    mention: `[@${OPUS}](https://tryluke.dev/workspace-${workspaceId}/plan/${plans.billing}/agent/${agents.teammates.id})`,
  };

  const listed = await call(CODER_TOOL.LIST_AGENTS, {});
  assert.equal(listed.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(listed));
  assert.deepEqual(listed.agents, [archived, teammates]);
  assert.deepEqual((await call(CODER_TOOL.LIST_AGENTS, { taskId: plans.billing })).agents, [
    teammates,
  ]);
  assert.deepEqual((await call(CODER_TOOL.LIST_AGENTS, { thisTask: true })).agents, [archived]);
  assert.deepEqual(await call(CODER_TOOL.LIST_AGENTS, { taskId: plans.billing, thisTask: true }), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: AGENT_LIST_FILTER_REFUSAL.BOTH,
  });
  assert.equal(eve.sent.length, 0, "a list sends nothing");
});

test("message_agent reaches a teammate's agent on another plan as the deployment acting for the caller's starter, opening with who sent it, kept under the sending agent's name, and sent once under the call's key", async () => {
  const { workspaceId, agents } = await openWorkspaces();
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
  assert.deepEqual(await database.run(lineSenderUnder(teammates, "call-1")), {
    kind: MESSAGE_SENDER.AGENT,
    name: CALLER_TITLE,
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
  const { workspaceId, plans, agents } = await openWorkspaces();
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
  assert.equal(stored.taskId, plans.invitations);
  // The agent is answered with the mention its starter names it by, its title the model's until one is written.
  assert.equal(
    started.agent.mention,
    `[@${OPUS}](https://tryluke.dev/workspace-${workspaceId}/plan/${plans.invitations}/agent/${startedId})`,
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

test("start_agent with a branch starts an agent whose checkout is cloned at that branch and who is told to cut its own from it, and a branch GitHub does not hold is refused before anything starts", async () => {
  const { workspaceId, agents } = await openWorkspaces();
  const { caller } = agents;
  const eve = await fakeCoderEve(workspaceId, [STACKED_BRANCH]);
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
});

test("list_tasks names the open tasks of the caller's workspace, each with the mention it is named by, its own marked, and none of another's; start_agent starts on another of them by its taskId, refuses one of another workspace, and an agent on no task names its task or is refused", async () => {
  const { workspaceId, elsewhere, plans, agents } = await openWorkspaces();
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
        id: plans.billing,
        name: "Billing",
        isYourTask: false,
        mention: `[@Billing](${home}/${plans.billing})`,
      },
      {
        id: plans.invitations,
        name: "Teammate invitations",
        isYourTask: true,
        mention: `[@Teammate invitations](${home}/${plans.invitations})`,
      },
    ],
  );

  // Narrowed by words of a name, whatever their case, and paged by an offset.
  const billing = await call(CODER_TOOL.LIST_TASKS, { nameContains: "BILL" });
  assert.deepEqual(
    Array.isArray(billing.tasks) ? billing.tasks.map((task) => isRecord(task) && task.id) : [],
    [plans.billing],
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
    { taskId: plans.billing, prompt: "Add the invoice export." },
    "call-billing",
  );
  assert.equal(started.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(started));
  assert.ok(isRecord(started.agent) && isWireString(started.agent.id));
  const stored = Option.getOrThrow(
    await database.run(readCodingAgent(caller.userId, started.agent.id)),
  );
  assert.equal(stored.taskId, plans.billing);
  assert.equal(started.agent.onYourTask, false, "an agent started on another task is said to be");
  assert.equal(eve.sent.length, 1);
  // The same call run again answers the agent it made, and starts nothing.
  const again = await call(
    CODER_TOOL.START_AGENT,
    { taskId: plans.billing, prompt: "Add the invoice export." },
    "call-billing",
  );
  assert.ok(isRecord(again.agent), JSON.stringify(again));
  assert.equal(again.agent.id, started.agent.id);
  // Once its task has moved to another workspace, its agents with it as a move takes them, the call
  // tells nothing of that agent and still starts none.
  await database.run(
    Effect.flatMap(Database, (db) =>
      Effect.andThen(
        db.update(task).set({ organizationId: elsewhere }).where(eq(task.id, plans.billing)),
        db
          .update(codingAgent)
          .set({ organizationId: elsewhere })
          .where(eq(codingAgent.taskId, plans.billing)),
      ),
    ),
  );
  assert.deepEqual(
    await call(
      CODER_TOOL.START_AGENT,
      { taskId: plans.billing, prompt: "Add the invoice export." },
      "call-billing",
    ),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.NO_SUCH_TASK },
  );
  assert.equal(eve.sent.length, 1, "the call run again starts nothing");

  assert.deepEqual(
    await call(
      CODER_TOOL.START_AGENT,
      { taskId: plans.elsewhere, prompt: "Add the invoice export." },
      "call-elsewhere",
    ),
    { status: ACTION_RESULT_STATUS.REJECTED, reason: START_CODING_AGENT_REFUSAL.NO_SUCH_TASK },
  );
  assert.equal(eve.sent.length, 1, "a task of another workspace starts nothing");

  // An agent on no task is offered the tool too, and names the task it starts on.
  const sweeper = await planlessAgentOn(caller.userId, workspaceId);
  const fromNoTask = await peerCaller(hostOf(true), sweeper, eve.services);
  assert.deepEqual(await fromNoTask(CODER_TOOL.START_AGENT, { prompt: "Sweep." }, "call-none"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: START_CODING_AGENT_REFUSAL.NO_TASK,
  });
  const onTask = await fromNoTask(
    CODER_TOOL.START_AGENT,
    { taskId: plans.invitations, prompt: "Sweep the invitation tests." },
    "call-task",
  );
  assert.equal(onTask.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(onTask));
  assert.equal(eve.sent.length, 2);
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
  const { workspaceId, plans, agents } = await openWorkspaces();
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
      task: { id: plans.billing, name: "Billing", archived: false },
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

test("read_page reads a page a teammate showed on another task of the caller's workspace, its newest version or one named, its HTML cut on a line to the bound, and nothing of another workspace's or a version never written", async () => {
  const { workspaceId, plans, agents } = await openWorkspaces();
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), agents.caller, eve.services);
  const bob = agents.teammates.userId;
  const rows = Array.from({ length: 3_000 }, (_, at) => `<p>row ${at}</p>`).join("\n");
  const shown = Option.getOrThrow(
    await database.run(
      writePage(
        bob,
        plans.billing,
        { title: "Seats", html: "<h1>One</h1>" },
        { kind: PAGE_SHOWER.LUKE },
      ),
    ),
  );
  await database.run(
    writePage(
      bob,
      plans.billing,
      { pageId: shown.id, title: "Seats by month", html: rows },
      { kind: PAGE_SHOWER.LUKE },
    ),
  );
  const elsewhere = Option.getOrThrow(
    await database.run(
      writePage(
        agents.otherWorkspaces.userId,
        plans.elsewhere,
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
    ["Seats by month", 2, 2, { id: plans.billing, name: "Billing" }, false],
  );
  assert.ok(
    isWireString(read.mention) &&
      read.mention.startsWith("[@Seats by month](") &&
      read.mention.endsWith(`/plan/${plans.billing}/page/${shown.id})`),
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
