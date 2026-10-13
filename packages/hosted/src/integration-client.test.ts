import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedIntegrationsClient } from "./integration-client.js";
import { INTEGRATION_CALL_FAILURE } from "./integration-view.js";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "./integration-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const SIGN_IN = "https://vercel.com/connect/authorize/request-1";
const LINEAR = INTEGRATION_PROVIDER.LINEAR;

function client(): HostedIntegrationsClient {
  return new HostedIntegrationsClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("reads where every provider stands under the account's bearer", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/account/integrations": {
        answer: () => ({
          integrations: {
            linear: INTEGRATION_STATUS.CONNECTED,
            notion: INTEGRATION_STATUS.UNAVAILABLE,
            sentry: INTEGRATION_STATUS.UNAVAILABLE,
          },
        }),
      },
    });

    assert.deepEqual(yield* Effect.provide(client().statuses(), api.layer), {
      integrations: {
        linear: INTEGRATION_STATUS.CONNECTED,
        notion: INTEGRATION_STATUS.UNAVAILABLE,
        sentry: INTEGRATION_STATUS.UNAVAILABLE,
      },
    });
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect(
  "a provider an older service leaves out, or names in a status this build does not know, stands unavailable, and the others still stand",
  () =>
    Effect.gen(function* () {
      const older = fakeCloudApi({
        "GET /api/account/integrations": {
          answer: () => ({
            integrations: { linear: INTEGRATION_STATUS.CONNECTED, notion: "half-connected" },
          }),
        },
      });
      assert.deepEqual(yield* Effect.provide(client().statuses(), older.layer), {
        integrations: {
          linear: INTEGRATION_STATUS.CONNECTED,
          notion: INTEGRATION_STATUS.UNAVAILABLE,
          sentry: INTEGRATION_STATUS.UNAVAILABLE,
        },
      });

      const shapeless = fakeCloudApi({
        "GET /api/account/integrations": { answer: () => ({ integrations: "all of them" }) },
      });
      assert.deepEqual(yield* Effect.provide(client().statuses(), shapeless.layer), {
        failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
      });
    }),
);

it.effect(
  "a Connect answers the sign-in address, and the service's unavailable as its own word",
  () =>
    Effect.gen(function* () {
      const begun = fakeCloudApi({
        "POST /api/account/integrations/linear/connect": { answer: () => ({ url: SIGN_IN }) },
      });
      assert.deepEqual(yield* Effect.provide(client().connect(LINEAR), begun.layer), {
        url: SIGN_IN,
      });

      const refused = fakeCloudApi({
        "POST /api/account/integrations/linear/connect": {
          answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
          status: 503,
        },
      });
      assert.deepEqual(yield* Effect.provide(client().connect(LINEAR), refused.layer), {
        failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE,
      });
    }),
);

it.effect(
  "an address a browser should not open, or a status the wire does not know, is no answer",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/account/integrations/linear/connect": {
          answer: () => ({ url: "javascript:alert(1)" }),
        },
        "POST /api/account/integrations/linear/disconnect": {
          answer: () => ({ status: "half-connected" }),
        },
      });

      assert.deepEqual(yield* Effect.provide(client().connect(LINEAR), api.layer), {
        failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(yield* Effect.provide(client().disconnect(LINEAR), api.layer), {
        failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
      });
    }),
);

it.effect(
  "a Disconnect answers where the connection then stands; a failed service is unanswered",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/account/integrations/linear/disconnect": {
          answer: () => ({ status: INTEGRATION_STATUS.DISCONNECTED }),
        },
      });
      assert.deepEqual(yield* Effect.provide(client().disconnect(LINEAR), api.layer), {
        status: INTEGRATION_STATUS.DISCONNECTED,
      });

      api.fail(HTTP_STATUS.SERVER_ERROR);
      assert.deepEqual(yield* Effect.provide(client().disconnect(LINEAR), api.layer), {
        failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
      });
    }),
);
