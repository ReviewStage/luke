import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@sidecar/gateway";
import { INTEGRATION_CALL_FAILURE } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import type { WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { composeIntegrations, type IntegrationsClient } from "./compose-integrations.js";

/** The sign-in address the service answers, which must reach the browser and no window. */
const SIGN_IN = "https://vercel.com/connect/authorize/request-1";

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

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
    statuses: () => Effect.sync(() => ({ integrations: { linear: script.status } })),
    connect: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        return script.connectRefused
          ? { failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE }
          : { url: SIGN_IN };
      }),
    disconnect: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        script.status = INTEGRATION_STATUS.DISCONNECTED;
        return { status: script.status };
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
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, opened: service.opened, asked: service.asked };
  });
}

it.effect("a Connect opens the sign-in in the browser and tells the window only that it did", () =>
  Effect.gen(function* () {
    const { call, opened, asked } = yield* subject({ status: INTEGRATION_STATUS.DISCONNECTED });

    const answer = yield* call(GATEWAY_METHOD.INTEGRATIONS_CONNECT, LINEAR);
    // The answer is exactly whether the browser was sent; the address went to the browser alone.
    assert.deepEqual(answer, { opened: true });
    assert.deepEqual(opened, [SIGN_IN]);
    assert.deepEqual(asked, [INTEGRATION_PROVIDER.LINEAR]);
  }),
);

it.effect(
  "a sign-in the browser could not take, or the service refused, says why and opens nothing more",
  () =>
    Effect.gen(function* () {
      const unopened = yield* subject(
        { status: INTEGRATION_STATUS.DISCONNECTED },
        { opens: false },
      );
      assert.deepEqual(yield* unopened.call(GATEWAY_METHOD.INTEGRATIONS_CONNECT, LINEAR), {
        failure: INTEGRATION_CALL_FAILURE.NOT_OPENED,
      });

      const refused = yield* subject({
        status: INTEGRATION_STATUS.DISCONNECTED,
        connectRefused: true,
      });
      assert.deepEqual(yield* refused.call(GATEWAY_METHOD.INTEGRATIONS_CONNECT, LINEAR), {
        failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE,
      });
      assert.deepEqual(refused.opened, []);
    }),
);

it.effect("the statuses and a Disconnect are the service's answers, whole", () =>
  Effect.gen(function* () {
    const { call } = yield* subject({ status: INTEGRATION_STATUS.CONNECTED });

    assert.deepEqual(yield* call(GATEWAY_METHOD.INTEGRATIONS_STATUS), {
      integrations: { linear: INTEGRATION_STATUS.CONNECTED },
    });
    assert.deepEqual(yield* call(GATEWAY_METHOD.INTEGRATIONS_DISCONNECT, LINEAR), {
      status: INTEGRATION_STATUS.DISCONNECTED,
    });
    assert.deepEqual(yield* call(GATEWAY_METHOD.INTEGRATIONS_STATUS), {
      integrations: { linear: INTEGRATION_STATUS.DISCONNECTED },
    });
  }),
);

it.effect("a Connect or a Disconnect naming no provider this build knows is refused unasked", () =>
  Effect.gen(function* () {
    const script = { status: INTEGRATION_STATUS.CONNECTED };
    const { call, opened, asked } = yield* subject(script);
    for (const method of [
      GATEWAY_METHOD.INTEGRATIONS_CONNECT,
      GATEWAY_METHOD.INTEGRATIONS_DISCONNECT,
    ]) {
      const refusal = yield* Effect.flip(call(method, { provider: "myspace" }));
      assert.equal(refusal.code, GATEWAY_ERROR.INVALID_PARAMS);
    }
    assert.deepEqual(asked, []);
    assert.deepEqual(opened, []);
    assert.equal(script.status, INTEGRATION_STATUS.CONNECTED);
  }),
);

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
          GATEWAY_METHOD.INTEGRATIONS_DISCONNECT,
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
