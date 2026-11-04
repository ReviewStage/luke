import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_CALL_FAILURE } from "@repo/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import { MCP_CLIENTS_CALL_FAILURE } from "@repo/features/mcp-client-view";
import type { McpClient } from "@repo/features/mcp-client-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@repo/gateway";
import type { WireRecord, WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Effect } from "effect";
import {
  composeIntegrations,
  type IntegrationsClient,
  type McpClientsClient,
} from "./compose-integrations.js";
import { windowFocus } from "./window-focus.js";

/** The sign-in address the service answers, which must reach the browser and no window. */
const SIGN_IN = "https://vercel.com/connect/authorize/request-1";

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const UNAVAILABLE = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.UNAVAILABLE]),
) as Record<IntegrationProvider, IntegrationStatus>;

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

interface ServiceScript {
  status: IntegrationStatus;
  connectRefused?: boolean;
  /** The outside MCP clients the account allowed, as the service holds them. */
  clients?: McpClient[];
  /** Whether a revoke fails before it finishes, as one whose session lapsed does. */
  revokeFails?: boolean;
}

/** The member MCP server's address, as the service answers it. */
const SERVER_URL = "https://app.test/api/mcp";

/** An outside MCP client a member allowed, as the service lists it. */
const CLAUDE: McpClient = {
  clientId: "client-claude",
  name: "Claude",
  redirectUris: ["https://claude.test/cb"],
  allowedAt: 1_000,
  lastRefreshedAt: null,
};

const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** The service as a script over one account's connection, and what it was asked about. */
function fakeService(script: ServiceScript) {
  const opened: string[] = [];
  const asked: IntegrationProvider[] = [];
  const client: IntegrationsClient = {
    statuses: () =>
      Effect.sync(() => ({
        integrations: { ...UNAVAILABLE, linear: script.status },
      })),
    connect: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        return script.connectRefused
          ? { failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE }
          : { url: SIGN_IN };
      }),
    tools: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        return { tools: [{ name: "list_issues", description: "List issues." }] };
      }),
    cancel: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        if (script.status === INTEGRATION_STATUS.PENDING)
          script.status = INTEGRATION_STATUS.DISCONNECTED;
        return { status: script.status };
      }),
    disconnect: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        script.status = INTEGRATION_STATUS.DISCONNECTED;
        return { status: script.status };
      }),
    rename: (provider, connection, label) =>
      Effect.sync(() => {
        asked.push(provider);
        return {
          account: { provider, connection, label, primary: false, status: script.status },
        };
      }),
  };
  const mcpClients: McpClientsClient = {
    list: () =>
      Effect.sync(() => ({ serverUrl: SERVER_URL, clients: [...(script.clients ?? [])] })),
    revoke: (clientId) =>
      Effect.sync(() => {
        if (script.revokeFails) return { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED };
        script.clients = (script.clients ?? []).filter((each) => each.clientId !== clientId);
        return { serverUrl: SERVER_URL, clients: [...script.clients] };
      }),
  };
  return { client, mcpClients, opened, asked };
}

function subject(
  script: ServiceScript,
  options: { signedIn?: boolean; sendsNetwork?: boolean; opens?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(script);
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    const composer = yield* composeIntegrations({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => void events.push({ kind, payload }),
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      mcpClients: service.mcpClients,
      accountId: () => "user-dana",
      focus: yield* windowFocus,
      openExternal: (url) =>
        Effect.sync(() => {
          service.opened.push(url);
          return options.opens ?? true;
        }),
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /** Every telling of the outside MCP clients the host holds for the windows, whole, in order. */
    const clients = () =>
      events.flatMap((event) =>
        event.kind === GATEWAY_EVENT.MCP_CLIENTS_CHANGED ? [event.payload] : [],
      );
    return { call, clients, opened: service.opened, asked: service.asked };
  });
}

it.effect(
  "behind a closed account gate, or on a run that sends nothing, nothing is asked or opened",
  () =>
    Effect.gen(function* () {
      for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
        const script = { status: INTEGRATION_STATUS.CONNECTED };
        const { call, opened, asked } = yield* subject(script, options);
        for (const method of [
          GATEWAY_METHOD.INTEGRATIONS_STATUS,
          GATEWAY_METHOD.INTEGRATIONS_CONNECT,
          GATEWAY_METHOD.INTEGRATIONS_CANCEL,
          GATEWAY_METHOD.INTEGRATIONS_DISCONNECT,
          GATEWAY_METHOD.INTEGRATIONS_TOOLS,
        ]) {
          assert.deepEqual(yield* call(method, LINEAR), {
            failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
          });
        }
        assert.deepEqual(opened, []);
        assert.deepEqual(asked, []);
        assert.equal(script.status, INTEGRATION_STATUS.CONNECTED);
      }
    }),
);

it.effect(
  "a revoke that lands reads the held clients again before it answers, and one that did not finish answers so and leaves the client held",
  () =>
    Effect.gen(function* () {
      const script: ServiceScript = { status: INTEGRATION_STATUS.CONNECTED, clients: [CLAUDE] };
      const { call, clients } = yield* subject(script);
      yield* call(GATEWAY_METHOD.MCP_CLIENTS_FOLLOW);
      yield* settled;
      const held = (listed: readonly McpClient[]) => ({
        "user-dana": { rows: { serverUrl: SERVER_URL, clients: listed } },
      });
      assert.deepEqual(clients().at(-1), held([CLAUDE]));

      script.revokeFails = true;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.MCP_CLIENTS_REVOKE, { clientId: CLAUDE.clientId }),
        {
          failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED,
        },
      );
      assert.deepEqual(clients().at(-1), held([CLAUDE]));

      script.revokeFails = false;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.MCP_CLIENTS_REVOKE, { clientId: CLAUDE.clientId }),
        {
          serverUrl: SERVER_URL,
          clients: [],
        },
      );
      assert.deepEqual(clients().at(-1), held([]));
    }),
);
