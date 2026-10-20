import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  type CodingAgent,
  createCodingAgent,
  readCodingAgentByKey,
  readCodingAgentRouting,
} from "@luke/database/models/coding-agent-store";
import { sentLineId } from "@luke/database/models/ids";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@luke/database/models/recorded-session";
import { createTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Option, Redacted, Result, Stream } from "effect";
import { TestClock } from "effect/testing";
import { TURN_ORIGIN } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
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
} from "../brain-host/eve-sessions.js";
import { deploymentEveForAccounts } from "../deployment-eve.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import { NativeAgentSessions, routedSessions, sessionsRouter } from "./runtime-sessions.js";
import { startCodingAgent } from "./start.js";
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
 * and a Stop. Where no harness is provided, as in the eve apps, the Claude
 * Code agent is refused by name and nothing reaches eve. Synthetic accounts
 * and words throughout; the store is PGlite.
 */

/** The sessions of one runtime, writing down every call it takes. */
function recording(sessionPrefix: string) {
  const calls: string[] = [];
  const messages: EveMessage[] = [];
  const answers = { open: EVE_SEND_OUTCOME.ACCEPTED as string, status: 0 };
  const sessions: AgentSessions = {
    open: (message) =>
      Effect.sync(() => {
        calls.push(`open:${message.conversationId}`);
        messages.push(message);
        return answers.open === EVE_SEND_OUTCOME.ACCEPTED
          ? { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `${sessionPrefix}${randomUUID()}` }
          : { outcome: EVE_SEND_OUTCOME.FAILED, status: answers.status };
      }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        calls.push(`send:${sessionId}`);
        messages.push(message);
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() };
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

/** The two runtimes: eve, and Claude Code behind `NativeAgentSessions`, which writes down whom it acts for. */
function runtimes() {
  const eve = recording("wrun_");
  const claudeCode = recording(`${NATIVE_SESSION_PREFIX.claude_code}000000000001-`);
  const actingFor: string[] = [];
  const native = Layer.succeed(NativeAgentSessions, {
    sessions: (runtime, account) => {
      actingFor.push(account);
      return runtime === "claude_code"
        ? Option.some(Effect.succeed(claudeCode.sessions))
        : Option.none();
    },
  });
  return { eve, claudeCode, actingFor, native };
}

const RELAY = { owner: "Acme", name: "Relay" } as const;
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 6 }, (_, index) => ({
  id: 9_100 + index,
  login: RELAY.owner,
  accountId: 91_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;

/** GitHub, reaching the repository through each workspace's installation. */
const GITHUB = githubReaching(INSTALLATIONS).layer;

const RING = `1:${Buffer.alloc(32, 7).toString("base64")}`;

/** The deployment's environment: its eve secret, the cohort named, and the key ring. */
function environment(cohort: readonly string[]): Layer.Layer<HostedEnvironment> {
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
    nativeAgentAccounts: cohort,
    agentSandboxSnapshot: undefined,
  };
  return Layer.succeed(HostedEnvironment, values);
}

/** A workspace with its owner and a teammate, and a task of the owner's on no repository. */
const openTeam = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const teammate = yield* openGithubUser();
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);
  const task = yield* createTask(owner, { organizationId: workspaceId, name: "Invitations" });
  return { owner, teammate, workspaceId, taskId: task.id };
});

/** An agent of the owner's on the task, on the runtime and payer given. */
const agentOn = (owner: string, taskId: string, runtime: "eve" | "claude_code") =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(owner, {
      taskId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository: null,
      runtime,
      payer: runtime === "claude_code" ? CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION : undefined,
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
                environment([]),
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
      "who may write to an agent its starter's plan pays for: its starter, not a teammate, under the starter-only switch; anyone on eve; anyone where the switch says the workspace",
      () =>
        Effect.gen(function* () {
          const { owner, teammate, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const { eve, claudeCode, native } = runtimes();
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

          const toPlan = yield* Effect.result(
            steerCodingAgent(sessions, writer, teammate, onClaudeCode, line),
          );
          assert.ok(Result.isFailure(toPlan));
          assert.equal(toPlan.failure.error, HOSTED_REFUSAL.NOT_PERMITTED.error);
          assert.deepEqual(claudeCode.calls, []);
          const reach: EveReach = {
            eveOrigin: () => "https://luke.test",
            eveAs: () => eve.sessions,
          };
          const stop = yield* Effect.result(
            stoppedTurn(reach, writer, new Request("https://luke.test/"), teammate, onClaudeCode),
          );
          assert.ok(Result.isFailure(stop));
          assert.equal(stop.failure.error, HOSTED_REFUSAL.NOT_PERMITTED.error);

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
              writesToAgent(teammate, onClaudeCode, payer, PLAN_AGENT_WRITERS.WORKSPACE),
              writesToAgent(teammate, onEve, null),
            ],
            [true, false, true, true],
          );
        }),
    );

    it.effect(
      "where no native harness is provided, as in the eve apps, a Claude Code agent is refused by name and eve hears nothing",
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
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
]);

/** A workspace connected to GitHub, its owner keeping a Claude setup-token where asked. */
const openStarter = (setupToken: boolean) =>
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
    return { owner, workspaceId };
  });

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
      "a cohort account with a setup-token starts a Claude agent on Claude Code paid by its plan; a GPT model, an account outside the cohort, one with no setup-token, or a function with no harness starts on eve as today",
      () =>
        Effect.gen(function* () {
          const cases = [
            {
              name: "cohort, Claude, setup-token",
              cohort: true,
              token: true,
              model: "anthropic/claude-opus-5.5",
              native: true,
              on: "claude_code",
            },
            {
              name: "a GPT model",
              cohort: true,
              token: true,
              model: "openai/gpt-5.5",
              native: true,
              on: "eve",
            },
            {
              name: "outside the cohort",
              cohort: false,
              token: true,
              model: "anthropic/claude-opus-5.5",
              native: true,
              on: "eve",
            },
            {
              name: "no setup-token",
              cohort: true,
              token: false,
              model: "anthropic/claude-opus-5.5",
              native: true,
              on: "eve",
            },
            {
              name: "no harness here (P11b)",
              cohort: true,
              token: true,
              model: "anthropic/claude-opus-5.5",
              native: false,
              on: "eve",
            },
          ] as const;
          for (const each of cases) {
            const { owner, workspaceId } = yield* openStarter(each.token);
            const { eve, claudeCode, native } = runtimes();
            const layers = Layer.mergeAll(
              githubReaching(INSTALLATIONS).layer,
              CATALOG,
              environment(each.cohort ? [owner] : []),
              ...(each.native ? [native] : []),
            );
            const started = yield* startCodingAgent(
              routedSessions(eve.sessions, owner),
              owner,
              startIn(workspaceId, each.model),
            ).pipe(Effect.provide(layers));

            const routing = Option.getOrThrow(
              yield* readCodingAgentRouting(owner, started.agent.id),
            );
            assert.deepEqual(
              [routing.runtime, routing.payer],
              each.on === "claude_code"
                ? ["claude_code", CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION]
                : ["eve", null],
              each.name,
            );
            assert.deepEqual(
              [heard(eve), heard(claudeCode)],
              each.on === "claude_code" ? [[], ["open"]] : [["open"], []],
              each.name,
            );
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
            environment([owner]),
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
