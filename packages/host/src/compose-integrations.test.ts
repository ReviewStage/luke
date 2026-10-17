import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_CALL_FAILURE } from "@luke/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@luke/gateway";
import type { WireRecord } from "@luke/wire";
import { Effect } from "effect";
import { composeIntegrations, type IntegrationsClient } from "./compose-integrations.js";
import { noNetworkHttpClient } from "./testing/no-network.js";

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
}

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
  return { client, opened, asked };
}

function subject(
  script: ServiceScript,
  options: { signedIn?: boolean; sendsNetwork?: boolean; opens?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(script);
    const composer = yield* composeIntegrations({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      openExternal: (url) =>
        Effect.sync(() => {
          service.opened.push(url);
          return options.opens ?? true;
        }),
    }).pipe(Effect.provide(noNetworkHttpClient));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, opened: service.opened, asked: service.asked };
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
