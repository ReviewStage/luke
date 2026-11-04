import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@repo/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@repo/gateway";
import type { WireRecord, WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Effect } from "effect";
import { composeIntegrations, type IntegrationsClient } from "./compose-integrations.js";
import { windowFocus } from "./window-focus.js";

/** The sign-in address the service answers, which must reach the browser and no window. */
const SIGN_IN = "https://vercel.com/connect/authorize/request-1";

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const UNAVAILABLE = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.UNAVAILABLE]),
) as Record<IntegrationProvider, IntegrationStatus>;

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** The tools Linear's server lists, as the service answers them unless a test scripts otherwise. */
const LINEAR_TOOLS = { tools: [{ name: "list_issues", description: "List issues." }] };

interface ServiceScript {
  status: IntegrationStatus;
  connectRefused?: boolean;
  /** What a read of a server's tools answers; Linear's tools where none is given. */
  tools?: IntegrationToolsView;
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
        return script.tools ?? LINEAR_TOOLS;
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
    const focus = yield* windowFocus;
    // Every telling of the servers' tools the host holds for the windows, whole, in order.
    const told: WireValue[] = [];
    const composer = yield* composeIntegrations({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => {
          if (kind === GATEWAY_EVENT.INTEGRATION_TOOLS_CHANGED) told.push(payload);
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      focus,
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
    return { call, opened: service.opened, asked: service.asked, told, focus };
  });
}

/** Every step a held read has to take, taken: it runs on a fiber of its own. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

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
        ]) {
          assert.deepEqual(yield* call(method, LINEAR), {
            failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
          });
        }
        yield* call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_FOLLOW, LINEAR);
        yield* settled;
        assert.deepEqual(opened, []);
        assert.deepEqual(asked, []);
        assert.equal(script.status, INTEGRATION_STATUS.CONNECTED);
      }
    }),
);

it.effect(
  "a server's tools are held from their last read, asked again as a window comes forward, and kept where an ask fails",
  () =>
    Effect.gen(function* () {
      const script: ServiceScript = { status: INTEGRATION_STATUS.CONNECTED };
      const { call, asked, told, focus } = yield* subject(script);

      yield* call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_FOLLOW, LINEAR);
      yield* settled;
      assert.deepEqual(told.at(-1), { linear: { rows: LINEAR_TOOLS } });

      script.tools = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };
      yield* focus.raise;
      yield* settled;
      assert.deepEqual(asked, [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.LINEAR]);
      assert.deepEqual(told.at(-1), { linear: { rows: LINEAR_TOOLS } });

      const mended = {
        tools: [...LINEAR_TOOLS.tools, { name: "save_issue", description: "Save." }],
      };
      script.tools = mended;
      yield* focus.raise;
      yield* settled;
      assert.deepEqual(told.at(-1), { linear: { rows: mended } });
    }),
);
