import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { hostTurnId, sentLineId } from "@luke/database/models/ids";
import { sentLineStands } from "@luke/database/models/message-reads";
import { openPlanConversation } from "@luke/database/models/plan-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { joinWorkspace, openHostedStoreTestDatabase, startPlan } from "@luke/database/testing";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_TURN_TRIGGER,
  isRecord,
  isWireString,
  type WireRecord,
} from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { LINK_OUTCOME } from "../../github/github-installations.js";
import { HOSTED_TOOL_SET } from "../../plans/brain-tool-set.js";
import { END_CALL_TOOL } from "../../plans/end-call.js";
import { modelCatalogOf, type OfferedModel } from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  NO_GITHUB,
} from "../../testing/github-app-fake.js";
import { STEER_OUTCOME } from "../coder-host/steer.js";
import {
  CODING_AGENT_TOOL_REFUSAL,
  LIST_CODING_AGENTS_TOOL,
  MESSAGE_CODING_AGENT_TOOL,
  START_CODING_AGENT_REFUSAL,
  START_CODING_AGENT_TOOL,
} from "../coding-agent-tools.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "./bounds.js";
import {
  claimRuntimeSession,
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "./conversation.js";
import { type BrainHost, brainHost } from "./host.js";
import { planningToolDeclarations } from "./planning.js";
import type { BrainHostSeams } from "./production.js";

/**
 * The planning tools as eve runs them through the host's `runTool`, over the
 * real migrations on PGlite: a call is carried under the plan the admitted
 * conversation belongs to, and answers why it ran nothing, as a result the
 * model reads, for a name the turn was not offered, a conversation no plan
 * names, or an input that does not read. Synthetic accounts and plans
 * throughout.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** The installation ids handed out so far: one installation stands for one workspace, so each plan's workspace connects its own. */
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
  const plan = await planConversation(userId, RELAY_FULL_NAME);
  const agent = await agentOn(userId, plan.planId);
  const eve = await fakeCoderEve(plan.workspaceId);
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
  const opener = await database.createUser();
  const member = await database.createUser();
  const plan = await planConversation(opener, RELAY_FULL_NAME);
  await database.run(joinWorkspace(plan.workspaceId, member));
  const agent = await agentOn(opener, plan.planId);
  const eve = await fakeCoderEve(plan.workspaceId);
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
  const userId = await database.createUser();
  const plan = await planConversation(userId, RELAY_FULL_NAME);
  const eve = await fakeCoderEve(plan.workspaceId);
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

test("end_call is the one planning tool eve is told ends its turn, so the model is asked for no step after the goodbye it was told to add nothing to", () => {
  const endings = planningToolDeclarations()
    .filter((tool) => tool.endsTurn === true)
    .map((tool) => tool.name);
  assert.deepEqual(endings, [END_CALL_TOOL.name]);
});
