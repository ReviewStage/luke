import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  createCodingAgent,
  readCodingAgentRouting,
  readRunnerTokenConversation,
  recordCodingAgentRunnerToken,
  takeCodingAgentMentionedServers,
} from "@luke/database/models/coding-agent-store";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import {
  claimRuntimeSession,
  recordedRuntimeSession,
} from "@luke/database/models/recorded-session";
import { createTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { eq } from "drizzle-orm";
import { type Context, Effect, Layer, Option, Redacted, Result, Stream } from "effect";
import { SqlClient } from "effect/sql";
import { TURN_ORIGIN } from "../../core.js";
import { HOSTED_API_ERROR } from "../../http/http.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../../testing/github-app-fake.js";
import {
  NATIVE_RELAY_FAKE,
  nativeRelayFake,
  relayEnvironment,
} from "../../testing/native-relay-fake.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
} from "../brain-host/eve-sessions.js";
import { NATIVE_RELAY_CALL, NATIVE_RELAY_PATH } from "./native-relay.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
  RUNNER_CHOICE,
  routedSessions,
  runnerChoiceApplied,
  sessionsRouter,
} from "./runtime-sessions.js";
import { startCodingAgent } from "./start.js";
import { STEER_OUTCOME, steerCodingAgent } from "./steer.js";
import { type EveReach, stoppedTurn } from "./stop.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * native-relay.test.ts -- the planner's and an eve agent's tools reach a native agent through the web's relay route, and nothing else does.
 *
 * The eve apps provide the relay where a web function provides the
 * harnesses themselves (`native-relay.ts`), so the router their tools
 * compose (`sessionsRouter`, which the planner's host and the agent doors
 * read) hands a Claude Code agent's calls to it, and the web's route
 * (`native-relay-app.ts`) makes them on the harness acting for the account
 * the router named. Both ends are the production code, joined by a fake
 * network (`testing/native-relay-fake.ts`), over a recording harness and a
 * recording eve. An eve agent's calls still reach eve and the relay hears
 * nothing; a call without the deployment's own secret is refused before
 * anything is read; and a function with neither path still refuses a
 * native agent by name. Synthetic accounts and words throughout; the
 * store is PGlite.
 */

/** eve, writing down every call it takes. */
function recordingEve() {
  const calls: string[] = [];
  const sessions: AgentSessions = {
    open: (message) =>
      Effect.sync(() => {
        calls.push(`open:${message.conversationId}`);
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
      }),
    send: (sessionId) =>
      Effect.sync(() => {
        calls.push(`send:${sessionId}`);
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() };
      }),
    cancel: (sessionId) =>
      Effect.sync(() => {
        calls.push(`cancel:${sessionId}`);
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
  return { calls, sessions };
}

const RELAY = { owner: "Acme", name: "Relay" } as const;
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 4 }, (_, index) => ({
  id: 9_300 + index,
  login: RELAY.owner,
  accountId: 93_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;
const GITHUB = githubReaching(INSTALLATIONS).layer;
const RING = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const OPUS = "anthropic/claude-opus-5.5";

/** A workspace with its owner and a teammate, and a task of the owner's on no repository. */
const openTeam = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const teammate = yield* openGithubUser();
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);
  const task = yield* createTask(owner, { organizationId: workspaceId, name: "Invitations" });
  return { owner, teammate, workspaceId, taskId: task.id };
});

/** An agent of the owner's on the task, on the runtime given; a blank one is handed no plan, so its first words open its session. */
const agentOn = (owner: string, taskId: string, runtime: "eve" | "claude_code", blank = false) =>
  Effect.gen(function* () {
    const started = yield* createCodingAgent(owner, {
      taskId,
      idempotencyKey: randomUUID(),
      model: OPUS,
      effort: "high",
      planSnapshot: blank ? null : "# Invitations\n",
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

/** A native session recorded on the agent's conversation, as a launch claims it. */
const nativeSessionOf = (owner: string, agent: CodingAgent) =>
  Effect.gen(function* () {
    const session = `${NATIVE_SESSION_PREFIX.claude_code}000000000001-${randomUUID()}`;
    yield* claimRuntimeSession(
      { userId: owner, conversationId: agent.conversationId },
      session,
      new Date(0),
    );
    return session;
  });

/** Whether the message's own transaction wrote or locked the row: its xmin or xmax is this transaction's id. */
const heldHere = (
  table: "coding_agent" | "conversations",
  column: "conversation_id" | "id",
  id: string,
) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) =>
      sql<{
        readonly held: boolean;
      }>`select (xmin::text = (pg_current_xact_id()::text)::xid::text or xmax::text = (pg_current_xact_id()::text)::xid::text) as held from ${sql(table)} where ${sql(column)} = ${id}`,
  ).pipe(Effect.map((rows) => rows[0]?.held ?? false));

/** The servers standing on the conversation's agent's row, as eve's turn would meet them. */
const serversOfConversation = (conversationId: string) =>
  Database.use((db) =>
    db
      .select({ servers: codingAgent.mentionedServers })
      .from(codingAgent)
      .where(eq(codingAgent.conversationId, conversationId)),
  ).pipe(Effect.map((rows) => rows[0]?.servers ?? null));

/**
 * What a launch meets as it runs inside a message's hand-over, then its own write: whether the
 * message's transaction holds the agent's row, which a launch writes its runner's bearer to, and
 * the conversation's, which it holds while it hands the words over; and the servers standing.
 * A row the message holds is one a launch on the web's own connection would wait on until the
 * hand-over gave up. The bearer is then recorded as a launch records it.
 */
const launchMeets = (conversationId: string) =>
  Effect.gen(function* () {
    const held = {
      agent: yield* heldHere("coding_agent", "conversation_id", conversationId),
      conversation: yield* heldHere("conversations", "id", conversationId),
    };
    const servers = yield* serversOfConversation(conversationId);
    const [agent] = yield* Database.use((db) =>
      db
        .select({ id: codingAgent.id, userId: codingAgent.userId })
        .from(codingAgent)
        .where(eq(codingAgent.conversationId, conversationId)),
    );
    assert.ok(agent);
    const digest = `digest-${conversationId}`;
    yield* recordCodingAgentRunnerToken(agent.userId, agent.id, digest);
    // The row the bearer landed on is the one a launch on its own connection would have waited for.
    const [onAgent] = yield* Database.use((db) =>
      db
        .select({ id: codingAgent.id })
        .from(codingAgent)
        .where(eq(codingAgent.runnerTokenHash, digest)),
    );
    const launchWaits = onAgent === undefined ? held.conversation : held.agent;
    return { launchWaits, conversationHeld: held.conversation, servers };
  });

/** A raw post to the route, under the bearer given. */
const rawCall = (bearer: string | undefined, body: object) =>
  new Request(`${NATIVE_RELAY_FAKE.ORIGIN}${NATIVE_RELAY_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify(body),
  });

const steerLine = (userId: string, text = "Also the emails.") => ({
  text,
  clientKey: randomUUID(),
  sender: { kind: MESSAGE_SENDER.MEMBER, userId } as const,
});

it.layer(Layer.merge(getTestDB(), GITHUB))(
  "the eve apps reach a native agent through the web's relay",
  (it) => {
    it.effect(
      "the router the planner's and an eve agent's tools compose hands a Claude Code agent's every call to the web's harness, acting as the router names, and an eve agent's to eve with the relay hearing nothing",
      () =>
        Effect.gen(function* () {
          const { owner, teammate, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const relay = yield* nativeRelayFake();
          yield* Effect.addFinalizer(() => Effect.promise(relay.dispose));
          const eve = recordingEve();
          const route = yield* sessionsRouter.pipe(Effect.provide(relay.layer));
          const sessions = route(eve.sessions, teammate);

          const eveOpened = yield* sessions.open(messageTo(onEve));
          assert.ok(eveOpened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
          yield* sessions.send(eveOpened.sessionId, messageTo(onEve, "And the emails."));
          yield* sessions.cancel(eveOpened.sessionId, "turn_1");
          yield* sessions.reset(eveOpened.sessionId);
          assert.deepEqual(
            eve.calls.map((call) => call.split(":")[0]),
            ["open", "send", "cancel", "reset"],
          );
          assert.deepEqual(relay.statuses, [], "an eve agent's calls post nothing to the relay");

          const opened = yield* sessions.open(messageTo(onClaudeCode));
          assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED, JSON.stringify(opened));
          assert.ok(opened.sessionId.startsWith(NATIVE_SESSION_PREFIX.claude_code));
          const sent = yield* sessions.send(
            opened.sessionId,
            messageTo(onClaudeCode, "And the emails."),
          );
          assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
          assert.equal(
            (yield* sessions.cancel(opened.sessionId, "turn-1")).outcome,
            EVE_CANCEL_OUTCOME.ACCEPTED,
          );
          assert.equal((yield* sessions.reset(opened.sessionId)).outcome, EVE_RESET_OUTCOME.RESET);

          assert.deepEqual(
            relay.heard.map(({ call, runtime, account }) => [call, runtime, account]),
            [
              // A launch and a message act for the agent's starter, whose plan pays; a cancel or reset for the caller.
              ["open", "claude_code", owner],
              ["send", "claude_code", owner],
              ["cancel", "claude_code", teammate],
              ["reset", "claude_code", teammate],
            ],
          );
          assert.deepEqual(
            relay.heard.map(({ message }) => message),
            ["Expire invitations after a week.", "And the emails.", undefined, undefined],
          );
          assert.equal(eve.calls.length, 4, "eve heard nothing of the Claude Code agent");
          // A change of its model, which update_agent hands its runner, reaches it alike, acting for its starter.
          assert.equal(
            yield* runnerChoiceApplied(onClaudeCode).pipe(Effect.provide(relay.layer)),
            RUNNER_CHOICE.WRITTEN,
          );
          assert.deepEqual(relay.heard.at(-1)?.call, "retune");
          assert.deepEqual(relay.heard.at(-1)?.account, owner);
          // The session the relayed launch opened is the conversation's record, claimed in the eve app as the router claims one.
          assert.equal(
            yield* recordedRuntimeSession({
              userId: owner,
              conversationId: onClaudeCode.conversationId,
            }),
            opened.sessionId,
          );
        }),
    );

    it.effect(
      "a message and a Stop from there reach a Claude Code agent through the relay, and a Start decides the runtime as the panel's does",
      () =>
        Effect.gen(function* () {
          const { owner, teammate, taskId } = yield* openTeam;
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const session = yield* nativeSessionOf(owner, onClaudeCode);
          const relay = yield* nativeRelayFake();
          yield* Effect.addFinalizer(() => Effect.promise(relay.dispose));
          const eve = recordingEve();
          const writer = storeWriter({ tools: CODER_TOOL_SET });

          // A teammate's message, which the planner's message_agent and an eve agent's send as this does.
          const sessions = yield* routedSessions(eve.sessions, teammate).pipe(
            Effect.provide(relay.layer),
          );
          assert.equal(
            yield* steerCodingAgent(sessions, writer, teammate, onClaudeCode, steerLine(teammate)),
            STEER_OUTCOME.SENT,
          );

          // A Stop of the turn under way, which stop_agent makes as the panel's Stop does.
          const turnId = randomUUID();
          const write = yield* writer;
          yield* write.enqueueTurn(
            { userId: owner, conversationId: onClaudeCode.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );
          const reach: EveReach = {
            eveOrigin: () => NATIVE_RELAY_FAKE.ORIGIN,
            eveAs: () => eve.sessions,
          };
          yield* stoppedTurn(
            reach,
            writer,
            new Request(`${NATIVE_RELAY_FAKE.ORIGIN}/`),
            teammate,
            onClaudeCode,
          ).pipe(Effect.provide(relay.layer));

          assert.deepEqual(
            relay.heard.map(({ call, account, names }) => [call, account, names]),
            [
              ["send", owner, session],
              ["cancel", teammate, `${session}:${turnId}`],
            ],
          );
          assert.deepEqual(eve.calls, []);

          // A Start from a cohort account with a setup-token decides Claude Code, and opens through the relay.
          const starter = yield* openGithubUser();
          const workspaceId = yield* openWorkspace(starter);
          const installation = INSTALLATIONS[installationsConnected++];
          assert.ok(installation);
          yield* connectWorkspaceGitHub(workspaceId, installation);
          const ring = parseKeyRing(Redacted.make(RING));
          assert.ok(Result.isSuccess(ring));
          const kind = {
            userId: starter,
            provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
            kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
          };
          yield* saveProviderKey(
            starter,
            kind.provider,
            kind.kind,
            sealProviderKey(ring.success, kind, Redacted.make("sk-ant-oat01-fixture")),
            "sk-ant-oat…ture",
            null,
            new Date(0),
          );
          const started = yield* startCodingAgent(routedSessions(eve.sessions, starter), starter, {
            taskId: null,
            organizationId: workspaceId,
            repository: `${RELAY.owner}/${RELAY.name}`,
            prompt: "Fix the flaky test.",
            idempotencyKey: randomUUID(),
            choice: { model: OPUS, effort: "high" },
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                githubReaching(INSTALLATIONS).layer,
                modelCatalogOf([
                  {
                    id: OPUS,
                    name: "Claude Opus 5.5",
                    provider: MODEL_PROVIDER.ANTHROPIC,
                    efforts: ["low", "medium", "high", "max"],
                  },
                ]),
                relayEnvironment(NATIVE_RELAY_FAKE.SECRET, [starter]),
                relay.layer,
              ),
            ),
          );
          const routing = Option.getOrThrow(
            yield* readCodingAgentRouting(starter, started.agent.id),
          );
          assert.deepEqual(
            [routing.runtime, routing.payer],
            ["claude_code", CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION],
          );
          assert.deepEqual(relay.heard.at(-1)?.call, "open");
          assert.deepEqual(relay.heard.at(-1)?.account, starter);
          assert.deepEqual(eve.calls, []);
        }),
    );

    it.effect(
      "a message mentioning a server to a Claude Code agent relaunched or launched through the relay holds no row the launch writes, so the launch never waits on it, and its servers stand once the harness took the words; an eve agent's are written before eve hears them, as before",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const relaunched = yield* agentOn(owner, taskId, "claude_code");
          const session = yield* nativeSessionOf(owner, relaunched);
          const launched = yield* agentOn(owner, taskId, "claude_code", true);
          const onEve = yield* agentOn(owner, taskId, "eve");
          yield* claimRuntimeSession(
            { userId: owner, conversationId: onEve.conversationId },
            "wrun_eve",
            new Date(0),
          );
          // Note that a launch writes the agent's row on the web's own connection in production, so a
          // row this transaction had already locked and written would hold it until the hand-over gave
          // up; here the one connection is shared, so what the harness reads is what it would wait on.
          const relay = yield* nativeRelayFake({ onLaunch: launchMeets });
          yield* Effect.addFinalizer(() => Effect.promise(relay.dispose));
          const eveSaw: unknown[] = [];
          const eve = recordingEve();
          const eveReading: AgentSessions = {
            ...eve.sessions,
            send: (sessionId, message) =>
              Effect.gen(function* () {
                // SAFETY: the steer hands eve its words inside the store's transaction, on its services.
                const services =
                  (yield* Effect.context<never>()) as Context.Context<DatabaseServices>;
                eveSaw.push(
                  yield* serversOfConversation(message.conversationId).pipe(
                    Effect.provideContext(services),
                    Effect.orDie,
                  ),
                );
                return yield* eve.sessions.send(sessionId, message);
              }),
          };
          const sessions = yield* routedSessions(eveReading, owner).pipe(
            Effect.provide(relay.layer),
          );
          const writer = storeWriter({ tools: CODER_TOOL_SET });
          const words = `Check ${mentionMarkdown(
            { kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR },
            "Linear",
            { workspace: "acme", repository: null },
          )} first.`;

          for (const agent of [relaunched, launched, onEve]) {
            assert.equal(
              yield* steerCodingAgent(sessions, writer, owner, agent, steerLine(owner, words)),
              STEER_OUTCOME.SENT,
            );
          }

          assert.deepEqual(
            relay.heard.map(({ call, names, seen }) => [call, names, seen]),
            [
              // The message holds the conversation's row, and never the row the launch writes its bearer to.
              ["send", session, { launchWaits: false, conversationHeld: true, servers: null }],
              [
                "open",
                launched.conversationId,
                { launchWaits: false, conversationHeld: true, servers: null },
              ],
            ],
          );
          assert.deepEqual(eveSaw, [[INTEGRATION_PROVIDER.LINEAR]]);
          // Each launch's bearer stands on its agent, found again by its digest as the runner's calls find it.
          for (const agent of [relaunched, launched]) {
            assert.equal(
              Option.getOrThrow(
                yield* readRunnerTokenConversation(`digest-${agent.conversationId}`),
              ).conversationId,
              agent.conversationId,
            );
          }
          for (const agent of [relaunched, launched]) {
            assert.deepEqual(yield* takeCodingAgentMentionedServers(owner, agent.conversationId), [
              INTEGRATION_PROVIDER.LINEAR,
            ]);
          }
        }),
    );

    it.effect(
      "the route admits only the deployment's own secret, acts only on an agent the named account reaches on the harness named, and runs nothing on a deployment that names no secret",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onEve = yield* agentOn(owner, taskId, "eve");
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          const session = yield* nativeSessionOf(owner, onClaudeCode);
          const stranger = yield* openGithubUser();
          const relay = yield* nativeRelayFake();
          yield* Effect.addFinalizer(() => Effect.promise(relay.dispose));
          const send = {
            call: NATIVE_RELAY_CALL.SEND,
            runtime: "claude_code",
            account: owner,
            sessionId: session,
            message: messageTo(onClaudeCode),
          };
          const answer = (bearer: string | undefined, body: object) =>
            Effect.promise(async () => {
              const response = await relay.post(rawCall(bearer, body));
              return { status: response.status, body: await response.json() };
            });

          // No bearer, the cron's, a wrong one, or a bare prefix: refused, and the harness hears nothing.
          for (const bearer of [undefined, "cron-secret-1", "eve-deployment-secret-2", ""]) {
            const refused = yield* answer(bearer, send);
            assert.deepEqual(refused, {
              status: 401,
              body: HOSTED_REFUSAL.INVALID_TOKEN,
            });
          }
          // An account that does not reach the agent, an agent on another runtime, or a session no harness minted.
          assert.equal(
            (yield* answer(NATIVE_RELAY_FAKE.SECRET, { ...send, account: stranger })).status,
            404,
          );
          assert.equal(
            (yield* answer(NATIVE_RELAY_FAKE.SECRET, { ...send, runtime: "codex" })).status,
            400,
          );
          assert.equal(
            (yield* answer(NATIVE_RELAY_FAKE.SECRET, { ...send, message: messageTo(onEve) }))
              .status,
            400,
          );
          assert.equal(
            (yield* answer(NATIVE_RELAY_FAKE.SECRET, {
              call: NATIVE_RELAY_CALL.RESET,
              runtime: "claude_code",
              account: owner,
              sessionId: "wrun_eve",
            })).status,
            400,
          );
          assert.deepEqual(relay.heard, []);
          assert.equal((yield* answer(NATIVE_RELAY_FAKE.SECRET, send)).status, 200);
          assert.equal(relay.heard.length, 1);

          // A deployment that names no secret admits nothing, not even an empty bearer.
          const unsecured = yield* nativeRelayFake({ webSecret: undefined });
          yield* Effect.addFinalizer(() => Effect.promise(unsecured.dispose));
          const response = yield* Effect.promise(() => unsecured.post(rawCall(undefined, send)));
          assert.equal(response.status, 503);
          assert.deepEqual(unsecured.heard, []);
        }),
    );

    it.effect(
      "a function with neither path still refuses a native agent by name: the web with no harness, or an eve app with no secret, which posts nothing",
      () =>
        Effect.gen(function* () {
          const { owner, taskId } = yield* openTeam;
          const onClaudeCode = yield* agentOn(owner, taskId, "claude_code");
          yield* nativeSessionOf(owner, onClaudeCode);
          const writer = storeWriter({ tools: CODER_TOOL_SET });
          for (const options of [{ harness: false }, { eveSecret: undefined }]) {
            const relay = yield* nativeRelayFake(options);
            yield* Effect.addFinalizer(() => Effect.promise(relay.dispose));
            const eve = recordingEve();
            const sessions = yield* routedSessions(eve.sessions, owner).pipe(
              Effect.provide(relay.layer),
            );
            const sent = yield* Effect.result(
              steerCodingAgent(sessions, writer, owner, onClaudeCode, steerLine(owner)),
            );
            assert.ok(Result.isFailure(sent));
            assert.equal(sent.failure.error, HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE);
            assert.deepEqual(eve.calls, []);
            assert.deepEqual(relay.heard, []);
            assert.deepEqual(relay.statuses, "harness" in options ? [503] : []);
          }
        }),
    );
  },
);
