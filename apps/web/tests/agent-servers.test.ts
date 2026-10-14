import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  createCodingAgent,
  updateCodingAgentServers,
} from "@sidecar/database/models/coding-agent-store";
import { storeWriter } from "@sidecar/database/models/writer";
import { getTestDB } from "@sidecar/database/testing";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";
import { Effect, Layer, Option, Result } from "effect";
import type { SessionAuth } from "eve/context";
import { GitHubApp } from "../server/github/github-app";
import { CONNECTION_POLICY } from "../server/hosted/agent-runtime/role";
import { type ServerStanding, turnServers } from "../server/hosted/agent-runtime/servers";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_PRINCIPAL_TYPE,
} from "../server/hosted/brain-host/bounds";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { GITHUB_APP_SETTINGS, openGithubUser } from "./support/github-app-fake";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
  integrationConnectOver,
} from "./support/integration-connect";
import { noNetwork } from "./support/no-network";
import { startPlan } from "./support/workspaces";

/**
 * The MCP servers an agent's turn is handed, read as the turn starts under
 * its role's policy: a coding agent's switched per agent from its composer,
 * under the root's admission and the worker's alike, and the planning
 * agents' every one, for a session admitted at all, among the integrations
 * the deployment offers the account. The store and the host are the real
 * ones over the migrations on PGlite; every provider is set up and offered
 * to every account but where a test reads a deployment's variables, and the
 * deployment holds the GitHub App, which is what offers GitHub.
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
    research: () => ({ openAi: undefined, spend: Effect.void }),
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

const GITHUB = INTEGRATION_PROVIDER.GITHUB;
const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const SLACK = INTEGRATION_PROVIDER.SLACK;
const { ALWAYS_ON, AGENT_SWITCHES } = CONNECTION_POLICY;

/** Every integration's server on, under the account. */
function allOn(account: string): ServerStanding {
  return { on: true, account, providers: INTEGRATION_PROVIDER_LIST };
}

const EVERY_CONNECTOR = integrationConnectOf(() => CONNECTOR_ASKED_NOTHING);

/** A deployment that holds the GitHub App, which is what offers GitHub. */
const GITHUB_APP = GitHubApp.layer(GITHUB_APP_SETTINGS);

it.layer(Layer.mergeAll(getTestDB(), noNetwork, EVERY_CONNECTOR, GITHUB_APP))(
  "an agent's MCP servers",
  (it) => {
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
      "a turn is handed no server the deployment does not offer the account: one its allowlist withholds from the account, or one not set up, reaches none of its agents",
      () =>
        Effect.gen(function* () {
          const host = yield* codingHost;
          const agent = yield* codingSession(host);
          yield* updateCodingAgentServers(agent.userId, agent.agentId, [LINEAR]);
          const deployment = (allowed: string) =>
            integrationConnectOver({
              LINEAR_CONNECTOR_UID: "oauth/linear",
              SLACK_CONNECTOR_UID: "oauth/slack",
              SLACK_ALLOWED_ACCOUNTS: allowed,
            });
          const handed = (allowed: string) =>
            Effect.all([
              turnServers(host.admit(agent.auth, agent.sessionId), ALWAYS_ON),
              turnServers(host.admitDelegated(agent.auth, mintSession()), ALWAYS_ON),
              turnServers(host.admit(agent.auth, agent.sessionId), AGENT_SWITCHES),
            ]).pipe(Effect.provide(deployment(allowed)));
          const standing = (providers: readonly IntegrationProvider[]): ServerStanding => ({
            on: true,
            account: agent.userId,
            providers,
          });

          // The account's email is the one `openGithubUser` left on its row.
          assert.deepEqual(yield* handed("@stagereview.example"), [
            standing([GITHUB, LINEAR]),
            standing([GITHUB, LINEAR]),
            standing([GITHUB]),
          ]);
          assert.deepEqual(yield* handed(`${agent.userId}@luke.test`), [
            standing([GITHUB, LINEAR, SLACK]),
            standing([GITHUB, LINEAR, SLACK]),
            standing([GITHUB, SLACK]),
          ]);
        }),
    );

    it.effect(
      "GitHub, granted by the account's own GitHub sign-in, is handed to a turn wherever the deployment holds the GitHub App, and to none where it holds none",
      () =>
        Effect.gen(function* () {
          const host = yield* codingHost;
          const agent = yield* codingSession(host);
          const handed = turnServers(host.admit(agent.auth, agent.sessionId), ALWAYS_ON);

          const withApp = yield* handed;
          assert.ok(withApp.on && withApp.providers.includes(GITHUB));
          const withoutApp = yield* handed.pipe(Effect.provide(GitHubApp.layer(undefined)));
          assert.ok(withoutApp.on && !withoutApp.providers.includes(GITHUB));
        }),
    );
  },
);
