import assert from "node:assert/strict";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";
import { Result } from "effect";
import type { McpClientConnectionDefinition } from "eve/connections";
import type { SessionAuth, SessionContext } from "eve/context";
import { test } from "vitest";
import coderIntegrations from "../coder/connections/integrations";
import coderWorkerIntegrations from "../coder/subagents/worker/connections/integrations";
import planningIntegrations from "../eve/connections/integrations";
import planningWorkerIntegrations from "../eve/subagents/worker/connections/integrations";
import {
  type ConnectionReads,
  integrationConnections,
} from "../server/hosted/agent-runtime/connections";
import type { ServerStanding } from "../server/hosted/agent-runtime/servers";
import { INTEGRATION, type IntegrationDefinition } from "../server/hosted/integrations";

/**
 * Each of the four agents registers one connection for every integration,
 * since eve hands a declared worker none of its parent's: the planning
 * model, the planning worker, the coding agent, and the coding agent's
 * worker. Each resolves as every turn starts, handing the turn the provider's
 * own server for each integration its standing has on, under the provider's
 * name, every tool on it or the ones its entry allows, credentialed per
 * session and keyed by the account. Which servers a standing has on is
 * `agent-servers.test.ts`'s to show, and which check a token read runs
 * under is `integration-connection.test.ts`'s.
 */

const AGENTS = [
  ["planning model", planningIntegrations],
  ["planning worker", planningWorkerIntegrations],
  ["coding agent", coderIntegrations],
  ["coding agent's worker", coderWorkerIntegrations],
] as const;

test.for(AGENTS)("the %s resolves its integrations as each turn starts", ([, registered]) => {
  assert.ok(registered.events["turn.started"] instanceof Function);
});

const ACCOUNT = "user-1";

/** What eve resolves for one turn of a session from one agent's connection, over the standing its reads answer. */
async function turnConnectionsOf(standing: ServerStanding) {
  const seen: [SessionAuth, string][] = [];
  const tokensAsked: IntegrationProvider[] = [];
  const reads: ConnectionReads = {
    servers: (auth, sessionId) => {
      seen.push([auth, sessionId]);
      return Promise.resolve(standing);
    },
    token: (provider) => () => {
      tokensAsked.push(provider);
      return Promise.resolve(Result.succeed({ token: "minted", expiresAt: 0 }));
    },
  };
  const resolve = integrationConnections(reads).events["turn.started"];
  if (resolve === undefined) throw new Error("the connection resolves no turn");
  const principal = {
    principalId: ACCOUNT,
    principalType: "user",
    authenticator: "test",
    attributes: {},
  };
  const auth: SessionAuth = { current: principal, initiator: principal };
  const session: SessionContext["session"] = {
    id: "wrun_01SERVERS000000000000000",
    auth,
    turn: { id: "turn_1", sequence: 1 },
  };
  // SAFETY: the resolver reads the session alone; the rest of eve's context is not its to read.
  const resolved = await resolve({}, { session, channel: {} } as never);
  assert.deepEqual(seen, [[auth, session.id]]);
  // Resolving a turn hands each connection its token read and reads no token itself.
  assert.deepEqual(tokensAsked, []);
  // SAFETY: the resolver answers a map of connections by name, or none.
  return resolved as Readonly<Record<string, McpClientConnectionDefinition>> | null;
}

test("a turn is handed every integration its standing has on, each under its provider's name, its own server and tool filter, keyed by the account", async () => {
  const handed = await turnConnectionsOf({
    on: true,
    account: ACCOUNT,
    providers: INTEGRATION_PROVIDER_LIST,
  });
  assert.ok(handed !== null);
  assert.deepEqual(Object.keys(handed), [...INTEGRATION_PROVIDER_LIST]);
  for (const provider of INTEGRATION_PROVIDER_LIST) {
    const integration: IntegrationDefinition = INTEGRATION[provider];
    const definition: McpClientConnectionDefinition | undefined = handed[provider];
    assert.ok(definition !== undefined, provider);
    assert.equal(definition.url, integration.MCP_URL);
    assert.equal(definition.description, integration.DESCRIPTION);
    assert.deepEqual(
      definition.tools,
      integration.ALLOWED_TOOLS === undefined ? undefined : { allow: integration.ALLOWED_TOOLS },
    );
    assert.equal(definition.approval, undefined);
    assert.equal(definition.instanceKey, ACCOUNT);
    assert.ok(definition.auth instanceof Function);
  }
});

test("a turn is handed only the integrations its standing has on, and none when it has none on or none at all", async () => {
  const notion = await turnConnectionsOf({
    on: true,
    account: ACCOUNT,
    providers: [INTEGRATION_PROVIDER.NOTION],
  });
  assert.deepEqual(Object.keys(notion ?? {}), [INTEGRATION_PROVIDER.NOTION]);
  assert.equal(await turnConnectionsOf({ on: true, account: ACCOUNT, providers: [] }), null);
  assert.equal(await turnConnectionsOf({ on: false }), null);
});

test("Slack is offered its search and read tools alone, so no agent can post, schedule, react, or write a canvas", () => {
  const allowed: readonly string[] = INTEGRATION[INTEGRATION_PROVIDER.SLACK].ALLOWED_TOOLS;
  for (const write of [
    "slack_send_message",
    "slack_send_message_draft",
    "slack_schedule_message",
    "slack_create_canvas",
    "slack_update_canvas",
    "slack_add_reaction",
  ]) {
    assert.ok(!allowed.includes(write), write);
  }
  for (const name of allowed) assert.match(name, /^slack_(search|read)_/);
});
