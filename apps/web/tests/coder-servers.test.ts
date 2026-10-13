import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  createCodingAgent,
  updateCodingAgentServers,
} from "@sidecar/database/models/coding-agent-store";
import { createPlan } from "@sidecar/database/models/plan-store";
import { storeWriter } from "@sidecar/database/models/writer";
import { getTestDB } from "@sidecar/database/testing";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { Effect, Layer, Logger, Option, Result } from "effect";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import type { McpClientConnectionDefinition } from "eve/connections";
import type { SessionAuth, SessionContext } from "eve/context";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_PRINCIPAL_TYPE,
} from "../server/hosted/brain-host/bounds";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import {
  type ServerStanding,
  switchableConnection,
  turnServer,
} from "../server/hosted/coder-host/servers";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { integrationConnection } from "../server/hosted/integration-connection";
import { INTEGRATION } from "../server/hosted/integrations";
import { openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";

/**
 * The MCP servers a coding agent's turn is handed, switched per agent from
 * its composer: the standing each turn reads from the agent's row as it
 * starts, under the root's admission and the worker's alike, and the
 * dynamic connection eve resolves from it, which hands a turn the
 * provider's connection while the server is on and none while it is off.
 * The store and the host are the real ones over the migrations on PGlite.
 */

const NOW = 1_800_000_000_000;

/** The coding-agent host over the test's store; nothing a standing reads is a seam of its. */
const codingHost = Effect.gen(function* () {
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  return coderHost({
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      sessionOwner: () => Promise.resolve(undefined),
      ownsConversation: () => Promise.resolve(false),
    },
    deploymentSecret: () => undefined,
    keys: () => Effect.succeed({ anthropic: undefined, openAi: undefined }),
    titleModel: () => undefined,
    scriptedModel: () => false,
    now: () => NOW,
  });
});

let minted = 0;
function mintSession(): string {
  minted += 1;
  return `wrun_01S${String(minted).padStart(22, "0")}`;
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

/** An account with a coding agent whose session was claimed as the coder's hook claims it. */
const codingSession = (host: CoderHost) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* createPlan(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
    const started = yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: `start-${mintSession()}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
      task: null,
      repository: "acme/relay",
    });
    assert.ok(Option.isSome(started));
    const agent = started.value.agent;
    const auth = typedSeat(userId, agent.conversationId);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    return { userId, agentId: agent.id, conversationId: agent.conversationId, auth, sessionId };
  });

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("a coding agent's MCP servers", (it) => {
  it.effect(
    "a turn is handed a server unless its agent switched it off, the worker following its parent, and switching it back on hands it again",
    () =>
      Effect.gen(function* () {
        const host = yield* codingHost;
        const agent = yield* codingSession(host);
        const other = yield* codingSession(host);
        const root = () => turnServer(host.admit(agent.auth, agent.sessionId), LINEAR);
        const worker = () => turnServer(host.admitDelegated(agent.auth, mintSession()), LINEAR);
        const on: ServerStanding = { on: true, account: agent.userId };

        assert.deepEqual(yield* root(), on);
        assert.deepEqual(yield* worker(), on);

        yield* updateCodingAgentServers(agent.userId, agent.agentId, [LINEAR]);
        assert.deepEqual(yield* root(), { on: false });
        assert.deepEqual(yield* worker(), { on: false });
        // Another agent of another account keeps what it had.
        assert.deepEqual(yield* turnServer(host.admit(other.auth, other.sessionId), LINEAR), {
          on: true,
          account: other.userId,
        });

        yield* updateCodingAgentServers(agent.userId, agent.agentId, []);
        assert.deepEqual(yield* root(), on);
      }),
  );

  it.effect(
    "a session admitted for no agent, or a row that could not be read, hands the turn no server, and the log keeps the failure's kind alone",
    () =>
      Effect.gen(function* () {
        const host = yield* codingHost;
        const agent = yield* codingSession(host);
        const theirs = yield* codingSession(host);
        // A session over another account's agent's conversation is admitted for no agent at all.
        const crossed = typedSeat(agent.userId, theirs.conversationId);
        assert.deepEqual(yield* turnServer(host.admit(crossed, agent.sessionId), LINEAR), {
          on: false,
        });

        const statement = 'select "disabled_servers" from "coding_agent" where "user_id" = $1';
        const logged: string[] = [];
        const capture = Logger.make((options) => {
          logged.push(JSON.stringify(options.message));
        });
        const unread = yield* turnServer(
          Effect.fail(
            new SqlError({
              reason: new UnknownError({ cause: new Error(statement), message: statement }),
            }),
          ),
          LINEAR,
        ).pipe(Effect.provide(Logger.layer([capture])));
        assert.deepEqual(unread, { on: false });
        assert.ok(logged.some((line) => line.includes("SqlError")));
        for (const line of logged) assert.ok(!line.includes(statement), line);
      }),
  );
});

/** A provider's own filter on the tools its server lists, which a turn is handed with the rest of its definition. */
const TOOL_FILTER = { allow: ["list_issues"] } as const;

/** What eve resolves for one turn of a session, from the connection a coding agent's file registers. */
async function turnConnectionOf(standing: ServerStanding) {
  const seen: [SessionAuth, string][] = [];
  const registered = switchableConnection(
    (auth, sessionId) => {
      seen.push([auth, sessionId]);
      return Promise.resolve(standing);
    },
    {
      ...integrationConnection(LINEAR, () =>
        Promise.reject(new Error("no token is read to resolve a turn")),
      ),
      tools: TOOL_FILTER,
    },
  );
  const resolve = registered.events["turn.started"];
  if (resolve === undefined) throw new Error("the connection resolves no turn");
  const auth = typedSeat("user-1", "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f");
  const session: SessionContext["session"] = {
    id: "wrun_01SERVERS000000000000000",
    auth,
    turn: { id: "turn_1", sequence: 1 },
  };
  // SAFETY: the resolver reads the session alone; the rest of eve's context is not its to read.
  const resolved = await resolve({}, { session, channel: {} } as never);
  assert.deepEqual(seen, [[auth, session.id]]);
  // SAFETY: the resolver answers one connection or none, never a set of them.
  return resolved as McpClientConnectionDefinition | null;
}

it("a turn whose agent has the server off is handed no connection; one with it on is handed the provider's own, its tool filter and all, keyed by its account", async () => {
  assert.equal(await turnConnectionOf({ on: false }), null);

  const handed = await turnConnectionOf({ on: true, account: "user-1" });
  assert.ok(handed !== null);
  assert.equal(handed.url, INTEGRATION.linear.MCP_URL);
  assert.equal(handed.description, INTEGRATION.linear.DESCRIPTION);
  assert.equal(handed.instanceKey, "user-1");
  assert.deepEqual(handed.tools, TOOL_FILTER);
  assert.ok(handed.auth instanceof Function);
});
