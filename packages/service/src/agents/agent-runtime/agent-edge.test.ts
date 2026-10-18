/**
 * agent-edge.test.ts -- the doors an eve root opens onto the agent runtime, run on a runner over a test database.
 */

import assert from "node:assert/strict";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { storeWriter } from "@luke/database/models/writer";
import { openHostedStoreTestDatabase, startTask } from "@luke/database/testing";
import { Deferred, Effect, Exit, Layer, Option, Result, Scope } from "effect";
import type { SessionAuth, SessionContext } from "eve/context";
import { afterAll, test } from "vitest";
import type { WebAgentRun } from "../../run.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { NO_GITHUB, openGithubUser } from "../../testing/github-app-fake.js";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
} from "../../testing/integration-connect.js";
import { recordingSentry, sentOfType } from "../../testing/sentry-transport.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_PRINCIPAL_TYPE } from "../brain-host/bounds.js";
import { memoryRelayState } from "../brain-host/relay.js";
import { type CoderHost, coderHost } from "../coder-host/host.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { type EdgeKit, edgeKit } from "./edge.js";
import { AGENT_ROLE, type AgentRole } from "./role.js";

/**
 * A session over another account's conversation is handed nothing under
 * either role. The store and the coding agent's host are the real ones;
 * GitHub and Connect are asked nothing.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;

/** The services beside the store's a door may require, none of which these doors reach. */
const ASKED_NOTHING = Layer.mergeAll(
  NO_GITHUB,
  integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
);

/** The suite's runner, as a root's `host.ts` hands its doors `runWeb`. */
const run: WebAgentRun = (effect) => database.run(Effect.provide(effect, ASKED_NOTHING));

let minted = 0;
function mintSession(): string {
  minted += 1;
  return `wrun_01E${String(minted).padStart(22, "0")}`;
}

/** The developer typing in their own agent's conversation. */
function typedSeat(userId: string, conversationId: string): SessionAuth {
  const principal = {
    principalId: userId,
    principalType: BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
    authenticator: "test",
    attributes: { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId },
  };
  return { current: principal, initiator: principal };
}

/** The coding-agent host over the suite's store, and the doors over it. */
async function openRoot(): Promise<{ host: CoderHost; edge: EdgeKit }> {
  const writer = await database.run(storeWriter({ tools: CODER_TOOL_SET }));
  const host = coderHost({
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      reachesSession: () => Promise.resolve(false),
      reachesConversation: () => Promise.resolve(false),
    },
    deploymentSecret: () => undefined,
    eveOrigin: () => undefined,
    keys: () => Effect.succeed({ anthropic: undefined, openAi: undefined }),
    fastRefused: async () => undefined,
    titleModel: () => undefined,
    research: () => ({ openAi: undefined, spend: Effect.void }),
    scriptedModel: () => false,
    now: () => NOW,
  });
  return { host, edge: edgeKit(run, { host, skills: () => Effect.succeed([]) }) };
}

/** An account with a coding agent whose session was claimed as the coder's hook claims it. */
async function openAgent(host: CoderHost) {
  return database.run(
    Effect.gen(function* () {
      const userId = yield* openGithubUser();
      const task = yield* startTask(userId, { name: "Invitations", repository: "acme/relay" });
      const started = yield* createCodingAgent(userId, {
        taskId: task.id,
        idempotencyKey: `start-${mintSession()}`,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        planSnapshot: "# Invitations\n",
        prompt: null,
        repository: "acme/relay",
      });
      assert.ok(Option.isSome(started));
      const { conversationId } = started.value.agent;
      const auth = typedSeat(userId, conversationId);
      const sessionId = mintSession();
      const starting = yield* host.admitStarting(auth, sessionId);
      assert.ok(Result.isSuccess(starting));
      assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
      return { userId, conversationId, auth, sessionId };
    }),
  );
}

/** The providers the role's connection hands one turn of the session, by name; none where it hands nothing. */
async function handedTo(edge: EdgeKit, role: AgentRole, auth: SessionAuth, sessionId: string) {
  const resolve = edge.integrationConnections(role).events["turn.started"];
  if (resolve === undefined) throw new Error("the connection resolves no turn");
  const session: SessionContext["session"] = {
    id: sessionId,
    auth,
    turn: { id: "turn_1", sequence: 1 },
  };
  // SAFETY: the resolver reads the session alone; the rest of eve's context is not its to read.
  const resolved = await resolve({}, { session, channel: {} } as never);
  return resolved === null ? null : Object.keys(resolved);
}

test("a session over another account's conversation is handed no server under either role", async () => {
  const { host, edge } = await openRoot();
  const agent = await openAgent(host);
  const theirs = await openAgent(host);
  const crossed = typedSeat(agent.userId, theirs.conversationId);

  assert.equal(await handedTo(edge, AGENT_ROLE.CODER, crossed, agent.sessionId), null);
  assert.equal(await handedTo(edge, AGENT_ROLE.CODER_WORKER, crossed, mintSession()), null);
});

test("a child's task that fails on its own fiber after the hook answered is reported to Sentry once", async () => {
  const { host } = await openRoot();
  const sentry = recordingSentry();
  const scope = await database.run(Scope.make());
  const reporting = await database.run(Layer.buildWithScope(sentry.layer, scope));
  // The root's runner as `runAgent` stands it, with Sentry's reporter among its services.
  const reported: WebAgentRun = (effect) => run(Effect.provideContext(effect, reporting));
  const tasked = await database.run(Deferred.make<void>());
  const edge = edgeKit(reported, {
    host,
    skills: () => Effect.succeed([]),
    childTasked: () =>
      Effect.ensuring(
        Effect.fail(new TypeError("the child's title could not be written")),
        Deferred.succeed(tasked, undefined),
      ),
  });
  const session: SessionContext["session"] = {
    id: mintSession(),
    auth: typedSeat("user-1", "conversation-1"),
    turn: { id: "turn_1", sequence: 1 },
  };
  const received = stampedEveEvent(
    { type: "message.received", data: { turnId: "turn_1", sequence: 1, message: "q" } },
    NOW,
  );

  await edge.relayChildEvent(received, session, memoryRelayState());
  await database.run(Deferred.await(tasked));
  await database.run(Scope.close(scope, Exit.void));

  const types = sentOfType(sentry.sent, "event").map(
    (item) => item.payload.exception?.values.at(-1)?.type,
  );
  assert.deepEqual(types, ["TypeError"]);
});
