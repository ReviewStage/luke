import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  createCodingAgent,
  updateCodingAgentServers,
} from "@sidecar/database/models/coding-agent-store";
import { storeWriter } from "@sidecar/database/models/writer";
import { getTestDB } from "@sidecar/database/testing";
import { INTEGRATION_PROVIDER, INTEGRATION_PROVIDER_LIST } from "@sidecar/hosted/integration-wire";
import { Effect, Layer, Logger, Option, Result } from "effect";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import type { SessionAuth } from "eve/context";
import { CONNECTION_POLICY } from "../server/hosted/agent-runtime/role";
import { type ServerStanding, turnServers } from "../server/hosted/agent-runtime/servers";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_PRINCIPAL_TYPE,
} from "../server/hosted/brain-host/bounds";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";
import { startPlan } from "./support/workspaces";

/**
 * The MCP servers an agent's turn is handed, read as the turn starts under
 * its role's policy: a coding agent's switched per agent from its composer,
 * under the root's admission and the worker's alike, and the planning
 * agents' every one, for a session admitted at all. The store and the host
 * are the real ones over the migrations on PGlite.
 */

const NOW = 1_800_000_000_000;

/** The coding-agent host over the test's store; nothing a standing reads is a seam of its. */
const codingHost = Effect.gen(function* () {
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  return coderHost({
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      reachesSession: () => Promise.resolve(false),
      reachesConversation: () => Promise.resolve(false),
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
    const plan = yield* startPlan(userId, {
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
const { ALWAYS_ON, AGENT_SWITCHES } = CONNECTION_POLICY;

/** Every integration's server on, under the account. */
function allOn(account: string): ServerStanding {
  return { on: true, account, providers: INTEGRATION_PROVIDER_LIST };
}

/** Every integration's server but Linear's on, under the account. */
function linearOff(account: string): ServerStanding {
  return {
    on: true,
    account,
    providers: INTEGRATION_PROVIDER_LIST.filter((provider) => provider !== LINEAR),
  };
}

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("an agent's MCP servers", (it) => {
  it.effect(
    "a turn is handed a server unless its agent switched it off, the worker following its parent, and switching it back on hands it again",
    () =>
      Effect.gen(function* () {
        const host = yield* codingHost;
        const agent = yield* codingSession(host);
        const other = yield* codingSession(host);
        const root = () => turnServers(host.admit(agent.auth, agent.sessionId), AGENT_SWITCHES);
        const worker = () =>
          turnServers(host.admitDelegated(agent.auth, mintSession()), AGENT_SWITCHES);

        assert.deepEqual(yield* root(), allOn(agent.userId));
        assert.deepEqual(yield* worker(), allOn(agent.userId));

        yield* updateCodingAgentServers(agent.userId, agent.agentId, [LINEAR]);
        assert.deepEqual(yield* root(), linearOff(agent.userId));
        assert.deepEqual(yield* worker(), linearOff(agent.userId));
        // Another agent of another account keeps what it had.
        assert.deepEqual(
          yield* turnServers(host.admit(other.auth, other.sessionId), AGENT_SWITCHES),
          allOn(other.userId),
        );

        yield* updateCodingAgentServers(agent.userId, agent.agentId, []);
        assert.deepEqual(yield* root(), allOn(agent.userId));
      }),
  );

  it.effect(
    "a planning agent's turn is handed every server for a session admitted at all, whatever an agent's switches say, and none for one the host does not admit",
    () =>
      Effect.gen(function* () {
        const host = yield* codingHost;
        const agent = yield* codingSession(host);
        const theirs = yield* codingSession(host);
        yield* updateCodingAgentServers(agent.userId, agent.agentId, [LINEAR]);

        assert.deepEqual(
          yield* turnServers(host.admit(agent.auth, agent.sessionId), ALWAYS_ON),
          allOn(agent.userId),
        );
        assert.deepEqual(
          yield* turnServers(host.admitDelegated(agent.auth, mintSession()), ALWAYS_ON),
          allOn(agent.userId),
        );
        // A session over another account's conversation is admitted for nobody.
        const crossed = typedSeat(agent.userId, theirs.conversationId);
        assert.deepEqual(yield* turnServers(host.admit(crossed, agent.sessionId), ALWAYS_ON), {
          on: false,
        });
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
        assert.deepEqual(yield* turnServers(host.admit(crossed, agent.sessionId), AGENT_SWITCHES), {
          on: false,
        });

        const statement = 'select "disabled_servers" from "coding_agent" where "user_id" = $1';
        const logged: string[] = [];
        const capture = Logger.make((options) => {
          logged.push(JSON.stringify(options.message));
        });
        const unread = yield* turnServers(
          Effect.fail(
            new SqlError({
              reason: new UnknownError({ cause: new Error(statement), message: statement }),
            }),
          ),
          AGENT_SWITCHES,
        ).pipe(Effect.provide(Logger.layer([capture])));
        assert.deepEqual(unread, { on: false });
        assert.ok(logged.some((line) => line.includes("SqlError")));
        for (const line of logged) assert.ok(!line.includes(statement), line);
      }),
  );
});
