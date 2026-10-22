import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  type CodingAgent,
  createCodingAgent,
  readCodingAgentByKey,
  readCodingAgentRouting,
} from "@luke/database/models/coding-agent-store";
import { sentLineStands } from "@luke/database/models/message-reads";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  saveProviderKey,
  setProviderKeyForAgents,
  setProviderKeyStatus,
} from "@luke/database/models/provider-key-store";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@luke/database/models/recorded-session";
import { createTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { messages } from "@luke/database/schemas/storage";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import { CODING_AGENT_PAYER, type CodingAgentPayer } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { sentLineId } from "@luke/wire/host-ids";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Result, Stream } from "effect";
import { TestClock } from "effect/testing";
import { CHATGPT_OAUTH, sealChatGptCredentials } from "../../accounts/chatgpt-credentials.js";
import { TURN_ORIGIN } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { credentialMissing, HOSTED_REFUSAL, type HostedRefusal } from "../../http/http-effect.js";
import { type ModelChoiceRefused, modelCatalogOf } from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import { PLAN_AGENT_WRITERS, writesToAgent } from "../agent-reach.js";
import { IMAGE_PREPARING_STATUS } from "../agent-sandbox-image.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  PLAN_REFUSAL,
  type PlanRefusal,
} from "../brain-host/eve-sessions.js";
import { deploymentEveForAccounts } from "../deployment-eve.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
  NativeAgentSessions,
  type NativeSessions,
  RUNNER_CHOICE,
  routedSessions,
  runnerChoiceApplied,
  sessionsRouter,
} from "./runtime-sessions.js";
import { accountModelChoices, startCodingAgent } from "./start.js";
import { STEER_OUTCOME, steerCodingAgent } from "./steer.js";
import { type EveReach, eveFor, stoppedTurn } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * runtime-sessions.test.ts -- every way Luke reaches a coding agent's session answers it by the runtime its conversation runs on.
 *
 * Two agents stand side by side in one workspace: one on eve, as every
 * agent ran before native harnesses, and one on Claude Code, paid for by its
 * starter's Claude plan. eve and the native harness are each a fake that
 * writes down every call, so a test reads which of the two each call
 * reached and what it was handed. The eve agent's calls reach eve, handed
 * exactly what they were handed before this router stood, and the native
 * harness hears nothing of them; the Claude Code agent's reach the harness,
 * acting for its starter, and eve hears nothing of them. That holds for the
 * router itself, for every composition a route, the deployment, the agent
 * doors, and the planner's tools wrap their eve in, and for the paths that
 * run through them: a Start, a message from the composer or an Inbox answer,
 * and a Stop. A Codex agent, paid for by its starter's ChatGPT plan, is
 * answered by Codex alike, and neither eve nor Claude Code hears it. Where no
 * harness is provided, nor a relay to one, a native agent is refused by name
 * and nothing reaches eve. Synthetic accounts and words throughout; the
 * store is PGlite.
 */

/** The sessions of one runtime, writing down every call it takes. */
function recording(sessionPrefix: string) {
  const calls: string[] = [];
  const messages: EveMessage[] = [];
  const answers: {
    open: string;
    status: number;
    planRefusal?: PlanRefusal;
    planResetsAt?: number;
  } = {
    open: EVE_SEND_OUTCOME.ACCEPTED,
    status: 0,
  };
  const sessions: NativeSessions = {
    retune: (sessionId, conversationId) =>
      Effect.sync(() => {
        calls.push(`retune:${sessionId}:${conversationId}`);
        return RUNNER_CHOICE.WRITTEN;
      }),
    open: (message) =>
      Effect.sync(() => {
        calls.push(`open:${message.conversationId}`);
        messages.push(message);
        return answers.open === EVE_SEND_OUTCOME.ACCEPTED
          ? { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `${sessionPrefix}${randomUUID()}` }
          : {
              outcome: EVE_SEND_OUTCOME.FAILED,
              status: answers.status,
              ...(answers.planRefusal === undefined ? {} : { planRefusal: answers.planRefusal }),
            };
      }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        calls.push(`send:${sessionId}`);
        messages.push(message);
        return answers.planRefusal === undefined
          ? { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() }
          : {
              outcome: EVE_SEND_OUTCOME.FAILED,
              status: answers.status,
              planRefusal: answers.planRefusal,
              ...(answers.planResetsAt === undefined ? {} : { planResetsAt: answers.planResetsAt }),
            };
      }),
    cancel: (sessionId, turnId) =>
      Effect.sync(() => {
        calls.push(`cancel:${sessionId}:${turnId}`);
        return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED };
      }),
    reset: (sessionId) =>
      Effect.sync(() => {
        calls.push(`reset:${sessionId}`);
        return { outcome: EVE_RESET_OUTCOME.RESET };
      }),
    stream: (sessionId) => {
      calls.push(`stream:${sessionId}`);
      return Stream.empty;
    },
  };
  return { calls, messages, answers, sessions };
}

type Recording = ReturnType<typeof recording>;

/** The three runtimes: eve, and Claude Code and Codex behind `NativeAgentSessions`, which writes down whom it acts for. */
function runtimes() {
  const eve = recording("wrun_");
  const claudeCode = recording(`${NATIVE_SESSION_PREFIX.claude_code}000000000001-`);
  const codex = recording(NATIVE_SESSION_PREFIX.codex);
  const actingFor: string[] = [];
  const native = Layer.succeed(NativeAgentSessions, {
    sessions: (runtime, account) => {
      actingFor.push(account);
      return Option.some(
        Effect.succeed(runtime === "codex" ? codex.sessions : claudeCode.sessions),
      );
    },
  });
  return { eve, claudeCode, codex, actingFor, native };
}

const RELAY = { owner: "Acme", name: "Relay" } as const;
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 64 }, (_, index) => ({
  id: 9_100 + index,
  login: RELAY.owner,
  accountId: 91_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;

/** GitHub, reaching the repository through each workspace's installation. */
const GITHUB = githubReaching(INSTALLATIONS).layer;

const RING = `1:${Buffer.alloc(32, 7).toString("base64")}`;

/** The deployment's environment: its eve secret and the key ring. */
function environment(): Layer.Layer<HostedEnvironment> {
  const values: HostedEnvironmentValues = {
    openAiKey: undefined,
    anthropicKey: undefined,
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: undefined,
    eveDeploymentSecret: Redacted.make("eve-deployment-secret-1"),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: Redacted.make(RING),
  };
  return Layer.succeed(HostedEnvironment, values);
}

/** A workspace with its owner and a teammate, and a task of the owner's on no repository. */
const openTeam = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const teammate = yield* openGithubUser();
  // The owner's agents on eve run on its own keys, since Luke's pays for no coding agent.
  yield* saveApiKey(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC);
  yield* saveApiKey(owner, PROVIDER_KEY_PROVIDER.OPENAI);
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);
  const task = yield* createTask(owner, { organizationId: workspaceId, name: "Invitations" });
  return { owner, teammate, workspaceId, taskId: task.id };
});

/** An agent of the owner's on the task, on the runtime and payer given. */
const agentOn = (owner: string, taskId: string, runtime: "eve" | "claude_code" | "codex") =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(owner, {
      taskId,
      idempotencyKey: randomUUID(),
      model: runtime === "codex" ? "openai/gpt-5.5" : "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository: null,
      runtime,
      payer:
        runtime === "claude_code"
          ? CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION
          : runtime === "codex"
            ? CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION
            : undefined,
    });
    assert.ok(Option.isSome(started));
    return started.value.agent;
  });

const messageTo = (agent: CodingAgent, text = "Expire invitations after a week.") => ({
  conversationId: agent.conversationId,
  turn: BRAIN_HOST_TURN.TYPED,
  message: text,
});

/** Every call of the session interface on the agent's conversation, through the sessions given. */
const everyCall = (sessions: AgentSessions, agent: CodingAgent) =>
  Effect.gen(function* () {
    const opened = yield* sessions.open(messageTo(agent));
    assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
    yield* sessions.send(opened.sessionId, messageTo(agent, "And the emails."));
    yield* sessions.cancel(opened.sessionId, "turn-1");
    yield* sessions.reset(opened.sessionId);
    yield* Stream.runDrain(sessions.stream(opened.sessionId));
    return opened.sessionId;
  });

/** Which calls each runtime heard, by kind. */
const heard = (each: Recording) => each.calls.map((call) => call.split(":")[0]);

it.layer(Layer.merge(getTestDB(), GITHUB))(
  "a coding agent's sessions answered by its runtime",
  (it) => {
    it.effect(
      "a change of model reaches a Claude Code agent's runner through its harness, acting for its starter, and nothing of an eve agent's",
      () =>
        Effect.gen(function* () {
          const { owner, teammate, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, actingFor, native } = runtimes();
          const sessions = yield* routedSessions(eve.sessions, teammate).pipe(
            Effect.provide(native),
          );
          const eveOpened = yield* sessions.open(messageTo(onEve));
          const nativeOpened = yield* sessions.open(messageTo(onClaudeCode));
          assert.ok(eveOpened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
          assert.ok(nativeOpened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
          yield* claimRuntimeSession(
            { userId: owner, conversationId: onEve.conversationId },
            eveOpened.sessionId,
            new Date(0),
          );
          actingFor.length = 0;

          const onEveApplied = yield* runnerChoiceApplied(onEve).pipe(Effect.provide(native));
          const onClaudeCodeApplied = yield* runnerChoiceApplied(onClaudeCode).pipe(
            Effect.provide(native),
          );
          // Where this function reaches no harness, the next message carries the change instead.
          const unreached = yield* runnerChoiceApplied(onClaudeCode);

          assert.deepEqual(
            [onEveApplied, onClaudeCodeApplied, unreached],
            [RUNNER_CHOICE.NOT_LIVE, RUNNER_CHOICE.WRITTEN, RUNNER_CHOICE.NOT_LIVE],
          );
          assert.deepEqual(heard(eve), ["open"]);
          assert.deepEqual(claudeCode.calls.slice(1), [
            `retune:${nativeOpened.sessionId}:${onClaudeCode.conversationId}`,
          ]);
          assert.deepEqual(actingFor, [owner]);
        }),
    );

    it.effect(
      "an eve agent's every call reaches eve, handed what it was handed, and a Claude Code agent's reaches the harness acting for its starter, whoever calls",
      () =>
        Effect.gen(function* () {
          const { owner, teammate, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, actingFor, native } = runtimes();

          const sessions = yield* routedSessions(eve.sessions, teammate).pipe(
            Effect.provide(native),
          );
          const eveSession = yield* everyCall(sessions, onEve);
          assert.deepEqual(heard(eve), ["open", "send", "cancel", "reset", "stream"]);
          assert.deepEqual(eve.messages, [messageTo(onEve), messageTo(onEve, "And the emails.")]);
          assert.ok(
            eve.calls.every(
              (call) => call.includes(onEve.conversationId) || call.includes(eveSession),
            ),
          );
          assert.deepEqual(claudeCode.calls, []);

          const nativeSession = yield* everyCall(sessions, onClaudeCode);
          assert.deepEqual(heard(claudeCode), ["open", "send", "cancel", "reset"]);
          assert.equal(eve.calls.length, 5);
          // A launch and a message act for the agent's starter, whose plan pays; a cancel or reset for the caller, as eve's does.
          assert.deepEqual(actingFor, [owner, owner, teammate, teammate]);
          // The session the harness opened is the conversation's record, as eve's door records eve's.
          const recorded = yield* recordedRuntimeSession({
            userId: owner,
            conversationId: onClaudeCode.conversationId,
          });
          assert.equal(recorded, nativeSession);
        }),
    );

    it.effect(
      "every composition the entry points wrap eve in routes alike: a route's caller over a bearer or a cookie, the deployment for a GitHub wake, an automation, or a chat notice, and the agent doors' and the planner's router",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, native } = runtimes();
          const reach: EveReach = {
            eveOrigin: () => "https://luke.test",
            eve: () => eve.sessions,
            eveAs: () => eve.sessions,
          };
          const bearer = new Request("https://luke.test/api/agents", {
            headers: { authorization: "Bearer luke_fixture" },
          });
          const cookie = new Request("https://luke.test/api/agents");
          const route = yield* sessionsRouter.pipe(Effect.provide(native));
          const composed: readonly (readonly [
            string,
            AgentSessions<typeof BRAIN_HOST_TURN.TYPED>,
          ])[] = [
            [
              "a route's bearer",
              yield* eveFor<typeof BRAIN_HOST_TURN.TYPED>(reach, bearer, owner).pipe(
                Effect.provide(native),
              ),
            ],
            [
              "a route's cookie",
              yield* eveFor<typeof BRAIN_HOST_TURN.TYPED>(reach, cookie, owner).pipe(
                Effect.provide(native),
              ),
            ],
            ["the agent doors and the planner", route(eve.sessions, owner)],
          ];
          for (const [name, sessions] of composed) {
            const before = { eve: eve.calls.length, native: claudeCode.calls.length };
            yield* sessions.open(messageTo(onEve));
            assert.deepEqual(
              [eve.calls.length, claudeCode.calls.length],
              [before.eve + 1, before.native],
              name,
            );
            yield* sessions.open(messageTo(onClaudeCode));
            assert.deepEqual(
              [eve.calls.length, claudeCode.calls.length],
              [before.eve + 1, before.native + 1],
              name,
            );
          }

          // The deployment's own eve, over HTTP, as a GitHub wake, an automation, and a chat notice reach it.
          const posted: string[] = [];
          const deployment = yield* deploymentEveForAccounts<typeof BRAIN_HOST_TURN.TYPED>(
            "https://luke.test",
            "/eve/coder",
          ).pipe(
            Effect.provide(
              Layer.mergeAll(
                native,
                environment(),
                fakeHttpClientLayer(async (url) => {
                  posted.push(url);
                  return Response.json({ sessionId: "wrun_1" }, { status: 202 });
                }),
              ),
            ),
          );
          const asOwner = yield* deployment(owner);
          const before = claudeCode.calls.length;
          assert.equal((yield* asOwner.open(messageTo(onEve))).outcome, EVE_SEND_OUTCOME.ACCEPTED);
          assert.equal(posted.length, 1);
          yield* asOwner.open(messageTo(onClaudeCode));
          assert.deepEqual([posted.length, claudeCode.calls.length], [1, before + 1]);
        }),
    );

    it.effect(
      "a message from the composer or an Inbox answer reaches eve as before, and a Claude Code agent's runner under its line's own id",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, native } = runtimes();
          yield* claimRuntimeSession(
            { userId: owner, conversationId: onEve.conversationId },
            "wrun_eve",
            new Date(0),
          );
          const nativeSession = `${NATIVE_SESSION_PREFIX.claude_code}000000000001-${randomUUID()}`;
          yield* claimRuntimeSession(
            { userId: owner, conversationId: onClaudeCode.conversationId },
            nativeSession,
            new Date(0),
          );
          const writer = storeWriter({ tools: CODER_TOOL_SET });
          const sessions = yield* routedSessions(eve.sessions, owner).pipe(Effect.provide(native));
          const line = (clientKey: string) => ({
            text: "Expire invitations after a week.",
            clientKey,
            sender: { kind: MESSAGE_SENDER.MEMBER, userId: owner } as const,
          });

          assert.equal(
            yield* steerCodingAgent(sessions, writer, owner, onEve, line("key-eve")),
            STEER_OUTCOME.SENT,
          );
          assert.equal(
            yield* steerCodingAgent(sessions, writer, owner, onClaudeCode, line("key-native")),
            STEER_OUTCOME.SENT,
          );

          assert.deepEqual(eve.calls, ["send:wrun_eve"]);
          // eve is handed no id of Luke's for the line, as before.
          assert.equal(eve.messages[0]?.lineId, undefined);
          assert.deepEqual(claudeCode.calls, [`send:${nativeSession}`]);
          assert.equal(claudeCode.messages[0]?.lineId, sentLineId("key-native"));
        }),
    );

    it.effect(
      "a message to an agent Luke's key paid for is refused by name whatever its starter keeps now, and so is one to an agent on eve whose starter keeps no API key for its model, from before payers were recorded or on a key since removed; nothing reaches eve and no payer moves",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const bare = yield* openGithubUser();
          const bareTask = yield* createTask(bare, {
            organizationId: yield* openWorkspace(bare),
            name: "Invitations",
          });
          const onEveAs = (starter: string, onTask: string, payer: CodingAgentPayer | undefined) =>
            Effect.map(
              createCodingAgent(starter, {
                taskId: onTask,
                idempotencyKey: randomUUID(),
                model: "anthropic/claude-opus-5.5",
                effort: "high",
                planSnapshot: "# Invitations\n",
                prompt: null,
                repository: null,
                runtime: "eve",
                payer,
              }),
              (started) => Option.getOrThrow(started).agent,
            );
          const lukes = yield* onEveAs(owner, taskId, CODING_AGENT_PAYER.LUKE);
          const unrecorded = yield* onEveAs(bare, bareTask.id, undefined);
          const keyRemoved = yield* onEveAs(bare, bareTask.id, CODING_AGENT_PAYER.API_KEY);
          const { eve } = runtimes();
          const writer = storeWriter({ tools: CODER_TOOL_SET });
          const send = (starter: string, agent: CodingAgent) =>
            Effect.result(
              steerCodingAgent(eve.sessions, writer, starter, agent, {
                text: "Expire invitations after a week.",
                clientKey: randomUUID(),
                sender: { kind: MESSAGE_SENDER.MEMBER, userId: starter },
              }),
            );

          for (const [name, starter, agent] of [
            ["Luke's key paid, an API key saved since", owner, lukes],
            ["no payer recorded, no API key", bare, unrecorded],
            ["its API key removed", bare, keyRemoved],
          ] as const) {
            const sent = yield* send(starter, agent);
            assert.ok(Result.isFailure(sent), name);
            assert.deepEqual(sent.failure, credentialMissing(MODEL_PROVIDER.ANTHROPIC), name);
            const routing = Option.getOrThrow(yield* readCodingAgentRouting(starter, agent.id));
            assert.deepEqual(
              [routing.runtime, routing.payer],
              [
                "eve",
                agent === unrecorded
                  ? null
                  : agent === lukes
                    ? CODING_AGENT_PAYER.LUKE
                    : CODING_AGENT_PAYER.API_KEY,
              ],
              name,
            );
          }
          assert.deepEqual(eve.calls, []);
        }),
    );

    it.effect(
      "a Stop names the turn under way: eve's by eve's id, as before, and a Claude Code agent's by the turn's own",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, native } = runtimes();
          const writer = storeWriter({ tools: CODER_TOOL_SET });
          const nativeSession = `${NATIVE_SESSION_PREFIX.claude_code}000000000001-${randomUUID()}`;
          const sessionOf = new Map([
            [onEve.conversationId, "wrun_eve"],
            [onClaudeCode.conversationId, nativeSession],
          ]);
          const nativeTurn = randomUUID();
          for (const [agent, eveTurnId] of [
            [onEve, "turn_3"],
            [onClaudeCode, nativeTurn],
          ] as const) {
            const target = { userId: owner, conversationId: agent.conversationId };
            yield* claimRuntimeSession(
              target,
              sessionOf.get(agent.conversationId) ?? "",
              new Date(0),
            );
            const write = yield* writer;
            yield* write.enqueueTurn(target, {
              turnId: agent === onEve ? randomUUID() : nativeTurn,
              eveTurnId,
              origin: TURN_ORIGIN.TYPED,
            });
          }
          const reach: EveReach = {
            eveOrigin: () => "https://luke.test",
            eveAs: () => eve.sessions,
          };
          const request = new Request("https://luke.test/api/agents/stop");

          yield* stoppedTurn(reach, writer, request, owner, onEve).pipe(Effect.provide(native));
          yield* stoppedTurn(reach, writer, request, owner, onClaudeCode).pipe(
            Effect.provide(native),
          );

          assert.deepEqual(eve.calls, ["cancel:wrun_eve:turn_3"]);
          assert.deepEqual(claudeCode.calls, [`cancel:${nativeSession}:${nativeTurn}`]);
        }),
    );

    it.effect(
      "who may write to an agent its starter's plan pays for: any member, as today, its words reaching the harness acting for the starter, whose plan pays; under the starter-only switch, its starter alone",
      () =>
        Effect.gen(function* () {
          const { owner, teammate, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, actingFor, native } = runtimes();
          const writer = storeWriter({ tools: CODER_TOOL_SET });
          for (const agent of [onEve, onClaudeCode]) {
            yield* claimRuntimeSession(
              { userId: owner, conversationId: agent.conversationId },
              agent === onEve ? "wrun_eve" : `${NATIVE_SESSION_PREFIX.claude_code}000000000001-x`,
              new Date(0),
            );
          }
          const sessions = yield* routedSessions(eve.sessions, teammate).pipe(
            Effect.provide(native),
          );
          const line = {
            text: "Also the emails.",
            clientKey: randomUUID(),
            sender: { kind: MESSAGE_SENDER.MEMBER, userId: teammate } as const,
          };

          // A teammate's words reach the harness, acting for the starter whose plan pays.
          assert.equal(
            yield* steerCodingAgent(sessions, writer, teammate, onClaudeCode, line),
            STEER_OUTCOME.SENT,
          );
          assert.deepEqual(heard(claudeCode), ["send"]);
          assert.deepEqual(actingFor, [owner]);
          const reach: EveReach = {
            eveOrigin: () => "https://luke.test",
            eveAs: () => eve.sessions,
          };
          // And a teammate's Stop is admitted: the agent runs no turn, so it stops nothing.
          yield* stoppedTurn(
            reach,
            writer,
            new Request("https://luke.test/"),
            teammate,
            onClaudeCode,
          ).pipe(Effect.provide(native));

          assert.equal(
            yield* steerCodingAgent(sessions, writer, teammate, onEve, {
              ...line,
              clientKey: randomUUID(),
            }),
            STEER_OUTCOME.SENT,
          );

          const payer = Option.getOrThrow(
            yield* readCodingAgentRouting(owner, onClaudeCode.id),
          ).payer;
          assert.deepEqual(
            [
              writesToAgent(owner, onClaudeCode, payer),
              writesToAgent(teammate, onClaudeCode, payer),
              writesToAgent(owner, onClaudeCode, payer, PLAN_AGENT_WRITERS.STARTER),
              writesToAgent(teammate, onClaudeCode, payer, PLAN_AGENT_WRITERS.STARTER),
              writesToAgent(teammate, onEve, null, PLAN_AGENT_WRITERS.STARTER),
            ],
            [true, true, true, false, true],
          );
        }),
    );

    it.effect(
      "a Codex agent's every call reaches Codex acting for its starter, through the router, the agent doors' composition, a message, and a Stop, and neither eve nor Claude Code hears it",
      () =>
        Effect.gen(function* () {
          const { owner, teammate, taskId } = yield* openTeam;
          const onCodex = yield* agentOn(owner, taskId, "codex");
          const { eve, claudeCode, codex, actingFor, native } = runtimes();

          const sessions = yield* routedSessions(eve.sessions, teammate).pipe(
            Effect.provide(native),
          );
          const session = yield* everyCall(sessions, onCodex);
          assert.ok(session.startsWith(NATIVE_SESSION_PREFIX.codex));
          assert.deepEqual(heard(codex), ["open", "send", "cancel", "reset"]);
          assert.deepEqual(actingFor, [owner, owner, teammate, teammate]);
          assert.equal(
            yield* recordedRuntimeSession({
              userId: owner,
              conversationId: onCodex.conversationId,
            }),
            session,
          );

          // The agent doors' and the planner's router.
          const route = yield* sessionsRouter.pipe(Effect.provide(native));
          yield* route(eve.sessions, owner).open(messageTo(onCodex));
          assert.deepEqual(heard(codex), ["open", "send", "cancel", "reset", "open"]);

          // A message from the composer, under its line's own id.
          const writer = storeWriter({ tools: CODER_TOOL_SET });
          assert.equal(
            yield* steerCodingAgent(sessions, writer, teammate, onCodex, {
              text: "Also the emails.",
              clientKey: "key-codex",
              sender: { kind: MESSAGE_SENDER.MEMBER, userId: teammate },
            }),
            STEER_OUTCOME.SENT,
          );
          assert.equal(codex.messages.at(-1)?.lineId, sentLineId("key-codex"));

          // A Stop names the turn under way by its own id.
          const turnId = randomUUID();
          const write = yield* writer;
          yield* write.enqueueTurn(
            { userId: owner, conversationId: onCodex.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );
          const reach: EveReach = {
            eveOrigin: () => "https://luke.test",
            eveAs: () => eve.sessions,
          };
          yield* stoppedTurn(reach, writer, new Request("https://luke.test/"), owner, onCodex).pipe(
            Effect.provide(native),
          );
          assert.ok(
            codex.calls.at(-1)?.startsWith("cancel:") && codex.calls.at(-1)?.endsWith(turnId),
          );

          assert.deepEqual([eve.calls, claudeCode.calls], [[], []]);
        }),
    );

    it.effect(
      "a Codex agent whose starter's ChatGPT sign-in refuses is refused by name, signed out, OpenAI unreachable, the plan's limit reached or the account not eligible, and nothing turns to eve",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onCodex = yield* agentOn(owner, taskId, "codex");
          const { eve, codex, native } = runtimes();
          yield* claimRuntimeSession(
            { userId: owner, conversationId: onCodex.conversationId },
            `${NATIVE_SESSION_PREFIX.codex}${randomUUID()}`,
            new Date(0),
          );
          const sessions = yield* routedSessions(eve.sessions, owner).pipe(Effect.provide(native));
          const send = Effect.result(
            steerCodingAgent(sessions, storeWriter({ tools: CODER_TOOL_SET }), owner, onCodex, {
              text: "Also the emails.",
              clientKey: randomUUID(),
              sender: { kind: MESSAGE_SENDER.MEMBER, userId: owner },
            }),
          );
          const refusals: string[] = [];
          for (const refusal of Object.values(PLAN_REFUSAL)) {
            codex.answers.planRefusal = refusal;
            codex.answers.status = refusal === PLAN_REFUSAL.UNREACHABLE ? 503 : 403;
            const sent = yield* send;
            assert.ok(Result.isFailure(sent) && "error" in sent.failure, refusal);
            refusals.push(sent.failure.error);
          }

          assert.deepEqual(refusals, [
            HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT.error,
            HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT.error,
            HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT.error,
            HOSTED_REFUSAL.AGENT_PLAN_UNREACHABLE.error,
            HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED.error,
            HOSTED_REFUSAL.AGENT_PLAN_INELIGIBLE.error,
          ]);
          assert.deepEqual(eve.calls, []);
        }),
    );

    it.effect(
      "a Claude Code agent whose starter's Claude plan is refused or at its limit is refused by name, the limit with the reset Claude Code named, and nothing turns to eve",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, native } = runtimes();
          yield* claimRuntimeSession(
            { userId: owner, conversationId: onClaudeCode.conversationId },
            `${NATIVE_SESSION_PREFIX.claude_code}000000000001-x`,
            new Date(0),
          );
          const sessions = yield* routedSessions(eve.sessions, owner).pipe(Effect.provide(native));
          const send = Effect.result(
            steerCodingAgent(
              sessions,
              storeWriter({ tools: CODER_TOOL_SET }),
              owner,
              onClaudeCode,
              {
                text: "Also the emails.",
                clientKey: randomUUID(),
                sender: { kind: MESSAGE_SENDER.MEMBER, userId: owner },
              },
            ),
          );

          claudeCode.answers.status = 422;
          claudeCode.answers.planRefusal = PLAN_REFUSAL.SIGNED_OUT;
          const refused = yield* send;
          const resetsAt = Date.UTC(2026, 9, 21, 15, 40);
          claudeCode.answers.planRefusal = PLAN_REFUSAL.LIMIT_REACHED;
          claudeCode.answers.planResetsAt = resetsAt;
          const limited = yield* send;

          assert.ok(Result.isFailure(refused) && Result.isFailure(limited));
          assert.deepEqual(
            [refused.failure, limited.failure],
            [
              HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT,
              { ...HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED, resetsAt },
            ],
          );
          assert.deepEqual(eve.calls, []);
        }),
    );

    it.effect(
      "where no native harness is provided, nor a relay to one, a Claude Code agent is refused by name and eve hears nothing",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve } = runtimes();
          yield* claimRuntimeSession(
            { userId: owner, conversationId: onClaudeCode.conversationId },
            `${NATIVE_SESSION_PREFIX.claude_code}000000000001-x`,
            new Date(0),
          );
          const sessions = yield* routedSessions(eve.sessions, owner);

          const sent = yield* Effect.result(
            steerCodingAgent(
              sessions,
              storeWriter({ tools: CODER_TOOL_SET }),
              owner,
              onClaudeCode,
              {
                text: "Also the emails.",
                clientKey: randomUUID(),
                sender: { kind: MESSAGE_SENDER.MEMBER, userId: owner },
              },
            ),
          );

          assert.ok(Result.isFailure(sent));
          assert.equal(sent.failure.error, HOSTED_REFUSAL.NATIVE_AGENT_NOT_HERE.error);
          assert.deepEqual(eve.calls, []);
        }),
    );
  },
);

const CATALOG = modelCatalogOf([
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
  {
    id: "openai/gpt-5.5-fast",
    name: "GPT-5.5 (Fast)",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
]);

/** The catalog with a GPT model it lists no fast version of, as AI Gateway lists every GPT model. */
const PLAN_CATALOG = modelCatalogOf([
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
  {
    id: "openai/gpt-5.5-fast",
    name: "GPT-5.5 (Fast)",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
]);

/** How the owner's ChatGPT sign-in stands: none, one Codex launches on, one OpenAI signed out, or one sealed under a key the ring no longer holds. */
type SignIn = "none" | "signed_in" | "signed_out" | "rotated_out";

/** A workspace connected to GitHub, its owner keeping a Claude setup-token and a ChatGPT sign-in where asked. */
const openStarter = (setupToken: boolean, chatGpt: SignIn = "none") =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const workspaceId = yield* openWorkspace(owner);
    const installation = INSTALLATIONS[installationsConnected++];
    assert.ok(installation);
    yield* connectWorkspaceGitHub(workspaceId, installation);
    if (setupToken) {
      const ring = parseKeyRing(Redacted.make(RING));
      assert.ok(Result.isSuccess(ring));
      const kind = {
        userId: owner,
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      };
      yield* saveProviderKey(
        owner,
        kind.provider,
        kind.kind,
        sealProviderKey(ring.success, kind, Redacted.make("sk-ant-oat01-fixture")),
        "sk-ant-oat…ture",
        null,
        new Date(0),
      );
    }
    if (chatGpt !== "none") {
      const ring = parseKeyRing(
        Redacted.make(
          chatGpt === "rotated_out" ? `2:${Buffer.alloc(32, 9).toString("base64")}` : RING,
        ),
      );
      assert.ok(Result.isSuccess(ring));
      const { sealed, accessExpiresAt, hint } = sealChatGptCredentials(
        ring.success,
        owner,
        {
          clientId: "dynamic-client-fixture",
          accountId: "chatgpt-subject",
          accessToken: "access-0",
          refreshToken: "refresh-0",
          idToken: "id-token-0",
          expiresInSeconds: 3600,
          scopes: [CHATGPT_OAUTH.USAGE_SCOPE, "offline_access", "openid"],
        },
        new Date(0),
      );
      yield* saveProviderKey(
        owner,
        PROVIDER_KEY_PROVIDER.OPENAI,
        PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        sealed,
        hint,
        null,
        new Date(0),
        accessExpiresAt,
      );
      if (chatGpt === "signed_out") {
        const [row] = yield* listProviderKeyRows(owner, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
        assert.ok(row);
        yield* setProviderKeyStatus(
          owner,
          PROVIDER_KEY_PROVIDER.OPENAI,
          row.sealedKey,
          PROVIDER_KEY_STATUS.INVALID,
          new Date(0),
        );
      }
    }
    return { owner, workspaceId };
  });

/** The account's own Anthropic API key, saved as Settings saves one. */
/** An API key of the provider's saved for the owner, which eve's steps on its models run on. */
const saveApiKey = (
  owner: string,
  provider: typeof PROVIDER_KEY_PROVIDER.ANTHROPIC | typeof PROVIDER_KEY_PROVIDER.OPENAI,
) =>
  Effect.gen(function* () {
    const ring = parseKeyRing(Redacted.make(RING));
    assert.ok(Result.isSuccess(ring));
    const kind = { userId: owner, provider, kind: PROVIDER_KEY_KIND.API_KEY };
    yield* saveProviderKey(
      owner,
      kind.provider,
      kind.kind,
      sealProviderKey(ring.success, kind, Redacted.make(`${provider}-api-key-fixture`)),
      "sk-…ture",
      null,
      new Date(0),
    );
  });

/** The provider of a case's model, by its catalog id's prefix. */
const providerOfCase = (model: string): ModelProvider =>
  model.startsWith(`${MODEL_PROVIDER.OPENAI}/`) ? MODEL_PROVIDER.OPENAI : MODEL_PROVIDER.ANTHROPIC;

/** A Start refused because no credential of the account's pays for the provider named, which the refusal carries. */
function assertCredentialMissing(
  started: Result.Result<unknown, HostedRefusal | ModelChoiceRefused>,
  provider: ModelProvider,
  name: string,
): void {
  assert.ok(Result.isFailure(started) && "error" in started.failure, name);
  assert.deepEqual(started.failure, credentialMissing(provider), name);
}

const startIn = (workspaceId: string, model: string, key = randomUUID()) => ({
  taskId: null,
  organizationId: workspaceId,
  repository: `${RELAY.owner}/${RELAY.name}`,
  prompt: "Fix the flaky test.",
  idempotencyKey: key,
  choice: { model, effort: "high" },
});

it.layer(Layer.merge(getTestDB(), GITHUB))(
  "a Start decides the runtime and the payer once",
  (it) => {
    it.effect(
      "an account with a setup-token starts a Claude agent on Claude Code paid by its plan; a GPT model, an account with no setup-token, or a function with no harness, none with an API key, is refused by name with the provider and leaves no agent, since Luke's key pays for no coding agent",
      () =>
        Effect.gen(function* () {
          const cases = [
            {
              name: "Claude, setup-token",
              token: true,
              model: "anthropic/claude-opus-5.5",
              native: true,
              on: "claude_code",
            },
            {
              name: "a GPT model",
              token: true,
              model: "openai/gpt-5.5",
              native: true,
              on: MODEL_PROVIDER.OPENAI,
            },
            {
              name: "no plan connected",
              token: false,
              model: "anthropic/claude-opus-5.5",
              native: true,
              on: MODEL_PROVIDER.ANTHROPIC,
            },
            {
              name: "no harness here, nor a relay to one",
              token: true,
              model: "anthropic/claude-opus-5.5",
              native: false,
              on: MODEL_PROVIDER.ANTHROPIC,
            },
          ] as const;
          for (const each of cases) {
            const { owner, workspaceId } = yield* openStarter(each.token);
            const { eve, claudeCode, native } = runtimes();
            const layers = Layer.mergeAll(
              githubReaching(INSTALLATIONS).layer,
              CATALOG,
              environment(),
              ...(each.native ? [native] : []),
            );
            const ask = startIn(workspaceId, each.model);
            const started = yield* Effect.result(
              startCodingAgent(routedSessions(eve.sessions, owner), owner, ask).pipe(
                Effect.provide(layers),
              ),
            );

            if (each.on !== "claude_code") {
              assertCredentialMissing(started, each.on, each.name);
              assert.ok(Option.isNone(yield* readCodingAgentByKey(owner, ask.idempotencyKey)));
              assert.deepEqual([heard(eve), heard(claudeCode)], [[], []], each.name);
              continue;
            }
            assert.ok(Result.isSuccess(started), each.name);
            const routing = Option.getOrThrow(
              yield* readCodingAgentRouting(owner, started.success.agent.id),
            );
            assert.deepEqual(
              [routing.runtime, routing.payer],
              ["claude_code", CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION],
              each.name,
            );
            assert.deepEqual([heard(eve), heard(claudeCode)], [[], ["open"]], each.name);
          }
        }),
    );

    it.effect(
      "a Start's first message stands in a native agent's transcript as the line awaiting its turn, its id handed to the runner, which names it back as it takes it, on Claude Code and Codex alike; eve writes its own",
      () =>
        Effect.gen(function* () {
          const layers = (native: ReturnType<typeof runtimes>["native"]) =>
            Layer.mergeAll(githubReaching(INSTALLATIONS).layer, CATALOG, environment(), native);
          const cases = [
            {
              name: "Claude Code",
              token: true,
              chatGpt: "none",
              model: "anthropic/claude-opus-5.5",
            },
            { name: "Codex", token: false, chatGpt: "signed_in", model: "openai/gpt-5.5" },
          ] as const;
          for (const each of cases) {
            const { owner, workspaceId } = yield* openStarter(each.token, each.chatGpt);
            const { eve, claudeCode, codex, native } = runtimes();
            const started = yield* startCodingAgent(
              routedSessions(eve.sessions, owner),
              owner,
              startIn(workspaceId, each.model),
            ).pipe(Effect.provide(layers(native)));

            const [handed] = [...claudeCode.messages, ...codex.messages];
            assert.ok(handed?.lineId !== undefined, each.name);
            assert.ok(
              yield* sentLineStands(owner, started.agent.conversationId, handed.lineId),
              each.name,
            );
          }

          // An automation's run says its prompt as the automation, never as its creator.
          const automated = yield* openStarter(true);
          const byAutomation = runtimes();
          const run = yield* startCodingAgent(
            routedSessions(byAutomation.eve.sessions, automated.owner),
            automated.owner,
            {
              ...startIn(automated.workspaceId, "anthropic/claude-opus-5.5"),
              automationOrigin: {
                name: "Nightly checks",
                firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: 0 },
                prompt: "Fix the flaky test.",
              },
            },
          ).pipe(Effect.provide(layers(byAutomation.native)));
          const lineId = byAutomation.claudeCode.messages[0]?.lineId ?? "";
          const db = yield* Database;
          const [said] = yield* db
            .select({ sender: messages.sender, senderName: messages.senderName })
            .from(messages)
            .where(eq(messages.clientId, lineId));
          assert.deepEqual(said, {
            sender: MESSAGE_SENDER.AUTOMATION,
            senderName: "Nightly checks",
          });
          assert.ok(run.agent.conversationId !== "");

          const keyed = yield* openStarter(false);
          yield* saveApiKey(keyed.owner, PROVIDER_KEY_PROVIDER.ANTHROPIC);
          const onEve = runtimes();
          yield* startCodingAgent(
            routedSessions(onEve.eve.sessions, keyed.owner),
            keyed.owner,
            startIn(keyed.workspaceId, "anthropic/claude-opus-5.5"),
          ).pipe(Effect.provide(layers(onEve.native)));
          assert.equal(onEve.eve.messages[0]?.lineId, undefined);
        }),
    );

    it.effect(
      "a Start a Call opens a call into runs on eve on the account's API key with its words as the prompt, for an account the routing would otherwise send to Claude Code, and is refused by name where it saved no API key, the plan never paying for eve",
      () =>
        Effect.gen(function* () {
          const layers = (native: ReturnType<typeof runtimes>["native"]) =>
            Layer.mergeAll(githubReaching(INSTALLATIONS).layer, CATALOG, environment(), native);
          const keyed = yield* openStarter(true);
          yield* saveApiKey(keyed.owner, PROVIDER_KEY_PROVIDER.ANTHROPIC);
          const onKey = runtimes();
          const started = yield* startCodingAgent(
            routedSessions(onKey.eve.sessions, keyed.owner),
            keyed.owner,
            { ...startIn(keyed.workspaceId, "anthropic/claude-opus-5.5"), call: true },
          ).pipe(Effect.provide(layers(onKey.native)));

          const routing = Option.getOrThrow(
            yield* readCodingAgentRouting(keyed.owner, started.agent.id),
          );
          assert.deepEqual([routing.runtime, routing.payer], ["eve", CODING_AGENT_PAYER.API_KEY]);
          assert.deepEqual([heard(onKey.eve), heard(onKey.claudeCode)], [["open"], []]);
          assert.equal(started.agent.prompt, "Fix the flaky test.");

          const planOnly = yield* openStarter(true);
          const refusedOn = runtimes();
          const refused = yield* Effect.result(
            startCodingAgent(
              routedSessions(refusedOn.eve.sessions, planOnly.owner),
              planOnly.owner,
              {
                ...startIn(planOnly.workspaceId, "anthropic/claude-opus-5.5"),
                call: true,
              },
            ).pipe(Effect.provide(layers(refusedOn.native))),
          );
          assertCredentialMissing(refused, MODEL_PROVIDER.ANTHROPIC, "a plan and no API key");
          assert.deepEqual([heard(refusedOn.eve), heard(refusedOn.claudeCode)], [[], []]);
        }),
    );

    it.effect(
      "a blank Start routes by credential as any Start does: an account whose Claude plan pays records Claude Code and opens no session until its first words, and one with no credential is refused by name",
      () =>
        Effect.gen(function* () {
          // A blank Start lands on a task, here one naming no repository, so GitHub is never asked.
          const blankIn = (owner: string, workspaceId: string) =>
            Effect.map(
              createTask(owner, { organizationId: workspaceId, name: "Invitations" }),
              (task) => ({
                taskId: task.id,
                prompt: undefined,
                idempotencyKey: randomUUID(),
                choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
                blank: true,
              }),
            );
          const planned = yield* openStarter(true);
          const { eve, claudeCode, native } = runtimes();
          const layers = Layer.mergeAll(
            githubReaching(INSTALLATIONS).layer,
            CATALOG,
            environment(),
            native,
          );
          const started = yield* startCodingAgent(
            routedSessions(eve.sessions, planned.owner),
            planned.owner,
            yield* blankIn(planned.owner, planned.workspaceId),
          ).pipe(Effect.provide(layers));
          const routing = Option.getOrThrow(
            yield* readCodingAgentRouting(planned.owner, started.agent.id),
          );
          assert.deepEqual(
            [routing.runtime, routing.payer],
            ["claude_code", CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION],
          );
          assert.deepEqual([heard(eve), heard(claudeCode)], [[], []]);

          const none = yield* openStarter(false);
          const refused = yield* Effect.result(
            startCodingAgent(
              routedSessions(eve.sessions, none.owner),
              none.owner,
              yield* blankIn(none.owner, none.workspaceId),
            ).pipe(Effect.provide(layers)),
          );
          assertCredentialMissing(refused, MODEL_PROVIDER.ANTHROPIC, "no credential");
        }),
    );

    it.effect(
      "an account with a ChatGPT sign-in starts a GPT agent on Codex paid by its plan; a sign-in OpenAI signed out, none, or a function with no harness, none with an API key, is refused by name, and so is a Claude agent with no Claude credential",
      () =>
        Effect.gen(function* () {
          const cases = [
            {
              name: "GPT, signed in",
              chatGpt: "signed_in",
              model: "openai/gpt-5.5",
              native: true,
              on: "codex",
            },
            {
              name: "signed out",
              chatGpt: "signed_out",
              model: "openai/gpt-5.5",
              native: true,
              on: MODEL_PROVIDER.OPENAI,
            },
            {
              name: "a sign-in the ring no longer opens",
              chatGpt: "rotated_out",
              model: "openai/gpt-5.5",
              native: true,
              on: MODEL_PROVIDER.OPENAI,
            },
            {
              name: "no plan connected",
              chatGpt: "none",
              model: "openai/gpt-5.5",
              native: true,
              on: MODEL_PROVIDER.OPENAI,
            },
            {
              name: "no harness here, nor a relay to one",
              chatGpt: "signed_in",
              model: "openai/gpt-5.5",
              native: false,
              on: MODEL_PROVIDER.OPENAI,
            },
            {
              name: "a Claude model, no setup-token",
              chatGpt: "signed_in",
              model: "anthropic/claude-opus-5.5",
              native: true,
              on: MODEL_PROVIDER.ANTHROPIC,
            },
          ] as const;
          for (const each of cases) {
            const { owner, workspaceId } = yield* openStarter(false, each.chatGpt);
            const { eve, claudeCode, codex, native } = runtimes();
            const layers = Layer.mergeAll(
              githubReaching(INSTALLATIONS).layer,
              CATALOG,
              environment(),
              ...(each.native ? [native] : []),
            );
            const ask = startIn(workspaceId, each.model);
            const started = yield* Effect.result(
              startCodingAgent(routedSessions(eve.sessions, owner), owner, ask).pipe(
                Effect.provide(layers),
              ),
            );

            if (each.on !== "codex") {
              assertCredentialMissing(started, each.on, each.name);
              assert.ok(Option.isNone(yield* readCodingAgentByKey(owner, ask.idempotencyKey)));
              assert.deepEqual([heard(eve), heard(codex), heard(claudeCode)], [[], [], []]);
              continue;
            }
            assert.ok(Result.isSuccess(started), each.name);
            const routing = Option.getOrThrow(
              yield* readCodingAgentRouting(owner, started.success.agent.id),
            );
            assert.deepEqual(
              [routing.runtime, routing.payer],
              ["codex", CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION],
              each.name,
            );
            assert.deepEqual(
              [heard(eve), heard(codex), heard(claudeCode)],
              [[], ["open"], []],
              each.name,
            );
          }
        }),
    );

    it.effect(
      "a Start on Codex whose ChatGPT sign-in refuses the launch is refused by name, leaving no agent, and never starts on eve",
      () =>
        Effect.gen(function* () {
          const { owner, workspaceId } = yield* openStarter(false, "signed_in");
          const { eve, codex, native } = runtimes();
          codex.answers.open = EVE_SEND_OUTCOME.FAILED;
          codex.answers.status = 403;
          codex.answers.planRefusal = PLAN_REFUSAL.SIGNED_OUT;
          const ask = startIn(workspaceId, "openai/gpt-5.5");

          const refused = yield* Effect.result(
            startCodingAgent(routedSessions(eve.sessions, owner), owner, ask).pipe(
              Effect.provide(
                Layer.mergeAll(githubReaching(INSTALLATIONS).layer, CATALOG, environment(), native),
              ),
            ),
          );

          assert.ok(Result.isFailure(refused) && "error" in refused.failure);
          assert.equal(refused.failure.error, HOSTED_REFUSAL.AGENT_PLAN_SIGNED_OUT.error);
          assert.ok(Option.isNone(yield* readCodingAgentByKey(owner, ask.idempotencyKey)));
          assert.deepEqual([heard(codex), eve.calls], [["open"], []]);
        }),
    );

    it.effect(
      "where the Claude plan is offered, Settings' choice alone decides: Subscription runs every Claude model on Claude Code, a fast version with its own fast mode, and API key runs on eve on the API key; with no API key saved and the plan not selected, or nothing connected, the Start is refused, never run on Luke's key",
      () =>
        Effect.gen(function* () {
          const cases: readonly {
            readonly name: string;
            readonly plan: boolean;
            readonly forAgents: boolean;
            readonly apiKey: boolean;
            readonly model: string;
            readonly recorded: readonly [string, CodingAgentPayer | null] | "refused";
          }[] = [
            {
              name: "Subscription, an API key saved too",
              plan: true,
              forAgents: true,
              apiKey: true,
              model: "anthropic/claude-opus-5.5",
              recorded: ["claude_code", CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION],
            },
            {
              name: "Subscription, a fast version",
              plan: true,
              forAgents: true,
              apiKey: false,
              model: "anthropic/claude-opus-5.5-fast",
              recorded: ["claude_code", CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION],
            },
            {
              name: "API key, saved",
              plan: true,
              forAgents: false,
              apiKey: true,
              model: "anthropic/claude-opus-5.5",
              recorded: ["eve", CODING_AGENT_PAYER.API_KEY],
            },
            {
              name: "API key, a fast version",
              plan: true,
              forAgents: false,
              apiKey: true,
              model: "anthropic/claude-opus-5.5-fast",
              recorded: ["eve", CODING_AGENT_PAYER.API_KEY],
            },
            {
              name: "the plan off, no API key",
              plan: true,
              forAgents: false,
              apiKey: false,
              model: "anthropic/claude-opus-5.5",
              recorded: "refused",
            },
            {
              name: "no plan connected, an API key saved",
              plan: false,
              forAgents: true,
              apiKey: true,
              model: "anthropic/claude-opus-5.5",
              recorded: ["eve", CODING_AGENT_PAYER.API_KEY],
            },
            {
              name: "no plan connected, a fast version",
              plan: false,
              forAgents: true,
              apiKey: false,
              model: "anthropic/claude-opus-5.5-fast",
              recorded: "refused",
            },
          ];
          for (const each of cases) {
            const { owner, workspaceId } = yield* openStarter(each.plan);
            if (!each.forAgents) {
              const turned = yield* setProviderKeyForAgents(
                owner,
                PROVIDER_KEY_PROVIDER.ANTHROPIC,
                PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
                false,
              );
              assert.equal(turned, true, each.name);
            }
            if (each.apiKey) yield* saveApiKey(owner, PROVIDER_KEY_PROVIDER.ANTHROPIC);
            const { eve, claudeCode, native } = runtimes();
            const layers = Layer.mergeAll(
              githubReaching(INSTALLATIONS).layer,
              CATALOG,
              environment(),
              native,
            );
            const result = yield* Effect.result(
              startCodingAgent(
                routedSessions(eve.sessions, owner),
                owner,
                startIn(workspaceId, each.model),
              ).pipe(Effect.provide(layers)),
            );
            if (each.recorded === "refused") {
              assertCredentialMissing(result, providerOfCase(each.model), each.name);
              continue;
            }
            assert.ok(Result.isSuccess(result), each.name);
            const started = result.success;

            const routing = Option.getOrThrow(
              yield* readCodingAgentRouting(owner, started.agent.id),
            );
            assert.deepEqual([routing.runtime, routing.payer], each.recorded, each.name);
            assert.equal(started.agent.model, each.model, each.name);
            assert.deepEqual(
              [heard(eve), heard(claudeCode)],
              each.recorded[0] === "claude_code" ? [[], ["open"]] : [["open"], []],
              each.name,
            );
          }
        }),
    );

    it.effect(
      "where the ChatGPT plan is offered, Settings' choice alone decides: Subscription runs GPT models on Codex, and API key runs on eve on the OpenAI API key, and the Start is refused where none was saved",
      () =>
        Effect.gen(function* () {
          const cases: readonly {
            readonly name: string;
            readonly forAgents: boolean;
            readonly apiKey:
              | typeof PROVIDER_KEY_PROVIDER.OPENAI
              | typeof PROVIDER_KEY_PROVIDER.ANTHROPIC
              | undefined;
            readonly model: string;
            readonly recorded: readonly [string, CodingAgentPayer | null] | "refused";
          }[] = [
            {
              name: "Subscription, an API key saved too",
              forAgents: true,
              apiKey: PROVIDER_KEY_PROVIDER.OPENAI,
              model: "openai/gpt-5.5",
              recorded: ["codex", CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION],
            },
            {
              name: "API key, saved",
              forAgents: false,
              apiKey: PROVIDER_KEY_PROVIDER.OPENAI,
              model: "openai/gpt-5.5",
              recorded: ["eve", CODING_AGENT_PAYER.API_KEY],
            },
            {
              name: "API key, a fast version on eve",
              forAgents: false,
              apiKey: PROVIDER_KEY_PROVIDER.OPENAI,
              model: "openai/gpt-5.5-fast",
              recorded: ["eve", CODING_AGENT_PAYER.API_KEY],
            },
            {
              name: "the plan off, only an Anthropic API key saved",
              forAgents: false,
              apiKey: PROVIDER_KEY_PROVIDER.ANTHROPIC,
              model: "openai/gpt-5.5",
              recorded: "refused",
            },
          ];
          for (const each of cases) {
            const { owner, workspaceId } = yield* openStarter(false, "signed_in");
            if (!each.forAgents) {
              const turned = yield* setProviderKeyForAgents(
                owner,
                PROVIDER_KEY_PROVIDER.OPENAI,
                PROVIDER_KEY_KIND.CHATGPT_OAUTH,
                false,
              );
              assert.equal(turned, true, each.name);
            }
            if (each.apiKey !== undefined) yield* saveApiKey(owner, each.apiKey);
            const { eve, codex, native } = runtimes();
            const layers = Layer.mergeAll(
              githubReaching(INSTALLATIONS).layer,
              CATALOG,
              environment(),
              native,
            );
            const result = yield* Effect.result(
              startCodingAgent(
                routedSessions(eve.sessions, owner),
                owner,
                startIn(workspaceId, each.model),
              ).pipe(Effect.provide(layers)),
            );
            if (each.recorded === "refused") {
              assertCredentialMissing(result, providerOfCase(each.model), each.name);
              continue;
            }
            assert.ok(Result.isSuccess(result), each.name);
            const started = result.success;

            const routing = Option.getOrThrow(
              yield* readCodingAgentRouting(owner, started.agent.id),
            );
            assert.deepEqual([routing.runtime, routing.payer], each.recorded, each.name);
            assert.equal(started.agent.model, each.model, each.name);
            assert.deepEqual(
              [heard(eve), heard(codex)],
              each.recorded[0] === "codex" ? [[], ["open"]] : [["open"], []],
              each.name,
            );
          }
        }),
    );

    it.effect(
      "with the ChatGPT plan selected no GPT fast version is offered and every GPT model says so, one the catalog lists no fast version of too, and a Start on one is refused, never run at standard speed; with API key selected it is offered as before",
      () =>
        Effect.gen(function* () {
          for (const forAgents of [true, false]) {
            const { owner, workspaceId } = yield* openStarter(false, "signed_in");
            if (!forAgents) {
              yield* setProviderKeyForAgents(
                owner,
                PROVIDER_KEY_PROVIDER.OPENAI,
                PROVIDER_KEY_KIND.CHATGPT_OAUTH,
                false,
              );
              // API key selected is a key saved, which pays now that Luke's never does.
              yield* saveApiKey(owner, PROVIDER_KEY_PROVIDER.OPENAI);
            }
            const { eve, codex, native } = runtimes();
            const layers = Layer.mergeAll(
              githubReaching(INSTALLATIONS).layer,
              PLAN_CATALOG,
              environment(),
              native,
            );
            const choices = yield* accountModelChoices(owner).pipe(Effect.provide(layers));
            const gpt = choices.offered.filter((model) => model.provider === MODEL_PROVIDER.OPENAI);
            const started = yield* Effect.result(
              startCodingAgent(
                routedSessions(eve.sessions, owner),
                owner,
                startIn(workspaceId, "openai/gpt-5.5-fast"),
              ).pipe(Effect.provide(layers)),
            );

            if (forAgents) {
              assert.deepEqual(
                gpt.map((model) => [model.id, model.fastWithheldByPlan]),
                [
                  ["openai/gpt-5.5", true],
                  ["openai/gpt-6.1-sol", true],
                ],
              );
              assert.ok(Result.isFailure(started));
              assert.deepEqual([heard(eve), heard(codex)], [[], []]);
            } else {
              assert.deepEqual(
                gpt.map((model) => [model.id, model.fastWithheldByPlan]),
                [
                  ["openai/gpt-5.5", undefined],
                  ["openai/gpt-5.5-fast", undefined],
                  ["openai/gpt-6.1-sol", undefined],
                ],
              );
              assert.ok(Result.isSuccess(started));
              assert.equal(started.success.agent.model, "openai/gpt-5.5-fast");
            }
          }
        }),
    );

    it.effect(
      "a Start whose harness's image is still being prepared is refused by name, leaving no agent, so the same Start later starts it",
      () =>
        Effect.gen(function* () {
          const { owner, workspaceId } = yield* openStarter(true);
          const { eve, claudeCode, native } = runtimes();
          claudeCode.answers.open = EVE_SEND_OUTCOME.FAILED;
          claudeCode.answers.status = IMAGE_PREPARING_STATUS;
          const layers = Layer.mergeAll(
            githubReaching(INSTALLATIONS).layer,
            CATALOG,
            environment(),
            native,
          );
          const ask = startIn(workspaceId, "anthropic/claude-opus-5.5");

          const preparing = yield* Effect.result(
            startCodingAgent(routedSessions(eve.sessions, owner), owner, ask).pipe(
              Effect.provide(layers),
            ),
          );
          assert.ok(Result.isFailure(preparing) && "error" in preparing.failure);
          assert.equal(preparing.failure.error, HOSTED_REFUSAL.AGENT_IMAGE_PREPARING.error);
          assert.ok(Option.isNone(yield* readCodingAgentByKey(owner, ask.idempotencyKey)));

          yield* TestClock.adjust("1 minute");
          claudeCode.answers.open = EVE_SEND_OUTCOME.ACCEPTED;
          const started = yield* startCodingAgent(
            routedSessions(eve.sessions, owner),
            owner,
            ask,
          ).pipe(Effect.provide(layers));
          assert.equal(started.created, true);
          assert.deepEqual(heard(claudeCode), ["open", "open"]);
          assert.deepEqual(eve.calls, []);
        }),
    );
  },
);
