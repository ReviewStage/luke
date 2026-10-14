import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedIntegrationsClient } from "./integration-client.js";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_SIGN_IN_FAILURE,
  INTEGRATION_STATUS,
} from "./integration-wire.js";

/**
 * Where an account's integrations stand, as the host reads the service's
 * answer for its window: each sign-in failure the read found is kept where
 * this build can read it, and one it cannot read hides none of the others
 * nor any provider's status.
 */

const client = new HostedIntegrationsClient({
  serviceBaseUrl: "https://tryluke.dev",
  readAccessToken: () => Effect.succeed("token-1"),
  refreshAccount: () => Effect.void,
  readAccountKey: () => Effect.succeed("ada@example.com"),
});

it.effect("a read keeps each sign-in failure it can read, beside every provider's status", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/account/integrations": {
        answer: () => ({
          integrations: { granola: "disconnected", posthog: "expired" },
          signInFailures: [
            { provider: "granola", reason: "error", message: "The provider said no." },
            { provider: "posthog", reason: "canceled" },
            { provider: "granola", reason: "exploded" },
            "not a failure",
          ],
        }),
      },
    });

    const read = yield* Effect.provide(client.statuses(), api.layer);

    assert.ok(!("failure" in read));
    assert.equal(read.integrations[INTEGRATION_PROVIDER.GRANOLA], INTEGRATION_STATUS.DISCONNECTED);
    assert.equal(read.integrations[INTEGRATION_PROVIDER.POSTHOG], INTEGRATION_STATUS.EXPIRED);
    assert.deepEqual(read.signInFailures, [
      {
        provider: INTEGRATION_PROVIDER.GRANOLA,
        reason: INTEGRATION_SIGN_IN_FAILURE.ERROR,
        message: "The provider said no.",
      },
      { provider: INTEGRATION_PROVIDER.POSTHOG, reason: INTEGRATION_SIGN_IN_FAILURE.CANCELED },
    ]);
  }),
);

it.effect("a read from a service that names no failures has none", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/account/integrations": { answer: () => ({ integrations: { slack: "pending" } }) },
    });

    const read = yield* Effect.provide(client.statuses(), api.layer);

    assert.ok(!("failure" in read));
    assert.equal(read.signInFailures, undefined);
    assert.equal(read.integrations[INTEGRATION_PROVIDER.SLACK], INTEGRATION_STATUS.PENDING);
  }),
);
