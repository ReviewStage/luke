import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedLinearClient } from "./linear-client.js";
import { LINEAR_CALL_FAILURE } from "./linear-view.js";
import { LINEAR_STATUS } from "./linear-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const SIGN_IN = "https://vercel.com/connect/authorize/request-1";

function client(): HostedLinearClient {
  return new HostedLinearClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("reads where the connection stands under the account's bearer", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/account/linear": { answer: () => ({ status: LINEAR_STATUS.CONNECTED }) },
    });

    assert.deepEqual(yield* Effect.provide(client().status(), api.layer), {
      status: LINEAR_STATUS.CONNECTED,
    });
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect(
  "a Connect answers the sign-in address, and the service's unavailable as its own word",
  () =>
    Effect.gen(function* () {
      const begun = fakeCloudApi({
        "POST /api/account/linear/connect": { answer: () => ({ url: SIGN_IN }) },
      });
      assert.deepEqual(yield* Effect.provide(client().connect(), begun.layer), { url: SIGN_IN });

      const refused = fakeCloudApi({
        "POST /api/account/linear/connect": {
          answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
          status: 503,
        },
      });
      assert.deepEqual(yield* Effect.provide(client().connect(), refused.layer), {
        failure: LINEAR_CALL_FAILURE.UNAVAILABLE,
      });
    }),
);

it.effect(
  "an address a browser should not open, or a status the wire does not know, is no answer",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/account/linear/connect": { answer: () => ({ url: "javascript:alert(1)" }) },
        "POST /api/account/linear/disconnect": { answer: () => ({ status: "half-connected" }) },
      });

      assert.deepEqual(yield* Effect.provide(client().connect(), api.layer), {
        failure: LINEAR_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(yield* Effect.provide(client().disconnect(), api.layer), {
        failure: LINEAR_CALL_FAILURE.UNANSWERED,
      });
    }),
);

it.effect(
  "a Disconnect answers where the connection then stands; a failed service is unanswered",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/account/linear/disconnect": {
          answer: () => ({ status: LINEAR_STATUS.DISCONNECTED }),
        },
      });
      assert.deepEqual(yield* Effect.provide(client().disconnect(), api.layer), {
        status: LINEAR_STATUS.DISCONNECTED,
      });

      api.fail(HTTP_STATUS.SERVER_ERROR);
      assert.deepEqual(yield* Effect.provide(client().disconnect(), api.layer), {
        failure: LINEAR_CALL_FAILURE.UNANSWERED,
      });
    }),
);
