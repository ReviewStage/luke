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
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import { readMessageByClientId, sentLineStands } from "@luke/database/models/message-reads";
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
import { CODING_AGENT_BOUNDS, CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "../../core.js";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import { modelCatalogOf, type OfferedModel } from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
} from "../../testing/github-app-fake.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { claimRuntimeSession } from "../brain-host/conversation.js";
import { CODING_AGENT_TOOL_REFUSAL, START_CODING_AGENT_REFUSAL } from "../coding-agent-tools.js";
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
 * nothing, and a deployment with no secret sends nothing. Synthetic
 * accounts, plans, and words throughout.
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
async function fakeCoderEve(workspaceId: string) {
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

test("list_agents names every other agent of the caller's workspace, on any task and by any member, each with its task, archived ones marked, and none of another workspace's; it narrows to one task by its id or to the caller's own", async () => {
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

test("start_agent starts an agent on the caller's own task as the deployment acting for its starter, telling it which agent started it and how to report back, leaves the starter's default as it stood, and starts once under the call's key", async () => {
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

test("list_tasks names the open tasks of the caller's workspace, its own marked, and none of another's; start_agent starts on another of them by its taskId, refuses one of another workspace, and an agent on no task names its task or is refused", async () => {
  const { workspaceId, elsewhere, plans, agents } = await openWorkspaces();
  const { caller } = agents;
  const eve = await fakeCoderEve(workspaceId);
  const call = await peerCaller(hostOf(true), caller, eve.services);

  const listed = await call(CODER_TOOL.LIST_TASKS, {});
  assert.equal(listed.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(listed));
  assert.ok(Array.isArray(listed.tasks));
  const tasks = listed.tasks.flatMap((task) =>
    isRecord(task) ? [{ id: task.id, name: task.name, isYourTask: task.isYourTask }] : [],
  );
  assert.deepEqual(
    [...tasks].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [
      { id: plans.billing, name: "Billing", isYourTask: false },
      { id: plans.invitations, name: "Teammate invitations", isYourTask: true },
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
