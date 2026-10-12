import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@sidecar/gateway";
import { LINEAR_CALL_FAILURE } from "@sidecar/hosted/linear-view";
import { LINEAR_STATUS, type LinearStatus } from "@sidecar/hosted/linear-wire";
import { Effect } from "effect";
import { composeLinear, type LinearClient } from "./compose-linear.js";

/** The sign-in address the service answers, which must reach the browser and no window. */
const SIGN_IN = "https://vercel.com/connect/authorize/request-1";

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

interface ServiceScript {
  status: LinearStatus;
  connectRefused?: boolean;
}

/** The service as a script over one account's connection, and the addresses the browser was handed. */
function fakeService(script: ServiceScript) {
  const opened: string[] = [];
  const client: LinearClient = {
    status: () => Effect.sync(() => ({ status: script.status })),
    connect: () =>
      Effect.sync(() =>
        script.connectRefused ? { failure: LINEAR_CALL_FAILURE.UNAVAILABLE } : { url: SIGN_IN },
      ),
    disconnect: () =>
      Effect.sync(() => {
        script.status = LINEAR_STATUS.DISCONNECTED;
        return { status: script.status };
      }),
  };
  return { client, opened };
}

function subject(
  script: ServiceScript,
  options: { signedIn?: boolean; sendsNetwork?: boolean; opens?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(script);
    const composer = yield* composeLinear({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      openExternal: (url) =>
        Effect.sync(() => {
          service.opened.push(url);
          return options.opens ?? true;
        }),
    });
    const call = (method: GatewayMethod) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler({}, context);
    };
    return { call, opened: service.opened };
  });
}

it.effect("a Connect opens the sign-in in the browser and tells the window only that it did", () =>
  Effect.gen(function* () {
    const { call, opened } = yield* subject({ status: LINEAR_STATUS.DISCONNECTED });

    const answer = yield* call(GATEWAY_METHOD.LINEAR_CONNECT);
    assert.deepEqual(answer, { opened: true });
    assert.ok(!JSON.stringify(answer).includes(SIGN_IN));
    assert.deepEqual(opened, [SIGN_IN]);
  }),
);

it.effect(
  "a sign-in the browser could not take, or the service refused, says why and opens nothing more",
  () =>
    Effect.gen(function* () {
      const unopened = yield* subject({ status: LINEAR_STATUS.DISCONNECTED }, { opens: false });
      assert.deepEqual(yield* unopened.call(GATEWAY_METHOD.LINEAR_CONNECT), {
        failure: LINEAR_CALL_FAILURE.NOT_OPENED,
      });

      const refused = yield* subject({ status: LINEAR_STATUS.DISCONNECTED, connectRefused: true });
      assert.deepEqual(yield* refused.call(GATEWAY_METHOD.LINEAR_CONNECT), {
        failure: LINEAR_CALL_FAILURE.UNAVAILABLE,
      });
      assert.deepEqual(refused.opened, []);
    }),
);

it.effect("the status and a Disconnect are the service's answers, whole", () =>
  Effect.gen(function* () {
    const { call } = yield* subject({ status: LINEAR_STATUS.CONNECTED });

    assert.deepEqual(yield* call(GATEWAY_METHOD.LINEAR_STATUS), {
      status: LINEAR_STATUS.CONNECTED,
    });
    assert.deepEqual(yield* call(GATEWAY_METHOD.LINEAR_DISCONNECT), {
      status: LINEAR_STATUS.DISCONNECTED,
    });
    assert.deepEqual(yield* call(GATEWAY_METHOD.LINEAR_STATUS), {
      status: LINEAR_STATUS.DISCONNECTED,
    });
  }),
);

it.effect(
  "behind a closed account gate, or on a run that sends nothing, nothing is asked or opened",
  () =>
    Effect.gen(function* () {
      for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
        const script = { status: LINEAR_STATUS.CONNECTED };
        const { call, opened } = yield* subject(script, options);
        for (const method of [
          GATEWAY_METHOD.LINEAR_STATUS,
          GATEWAY_METHOD.LINEAR_CONNECT,
          GATEWAY_METHOD.LINEAR_DISCONNECT,
        ]) {
          assert.deepEqual(yield* call(method), { failure: LINEAR_CALL_FAILURE.UNANSWERED });
        }
        assert.deepEqual(opened, []);
        assert.equal(script.status, LINEAR_STATUS.CONNECTED);
      }
    }),
);
