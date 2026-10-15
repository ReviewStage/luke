import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi } from "@luke/wire/testing";
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

it.effect(
  "a read keeps each account it can read and where it may add one, and a call about one account names it in the query",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "GET /api/account/integrations": {
          answer: () => ({
            integrations: { notion: "connected" },
            accounts: [
              { provider: "notion", connection: "notion", status: "connected" },
              {
                provider: "notion",
                connection: "notion-2",
                label: "Personal",

                status: "pending",
              },
              { provider: "gmail", connection: "gmail", status: "connected" },
            ],
            addable: ["notion", "gmail"],
          }),
        },
        "POST /api/account/integrations/notion/connect": {
          answer: () => ({ url: "https://vercel.com/connect/authorize/r", connection: "notion-3" }),
        },
        "POST /api/account/integrations/notion/rename": {
          answer: (request) => ({
            account: {
              provider: "notion",
              connection: request.searchParams.get("connection") ?? "",
              label: JSON.parse(request.body ?? "{}").label,

              status: "connected",
            },
          }),
        },
      });

      const read = yield* Effect.provide(client.statuses(), api.layer);
      assert.ok(!("failure" in read));
      // A provider this build does not know is left out of both, and hides none of the others.
      assert.deepEqual(
        read.accounts?.map((account) => [account.connection, account.label, account.status]),
        [
          ["notion", undefined, INTEGRATION_STATUS.CONNECTED],
          ["notion-2", "Personal", INTEGRATION_STATUS.PENDING],
        ],
      );
      assert.deepEqual(read.addable, [INTEGRATION_PROVIDER.NOTION]);

      const added = yield* Effect.provide(
        client.connect(INTEGRATION_PROVIDER.NOTION, { add: true }),
        api.layer,
      );
      assert.deepEqual(added, {
        url: "https://vercel.com/connect/authorize/r",
        connection: "notion-3",
      });
      const renamed = yield* Effect.provide(
        client.rename(INTEGRATION_PROVIDER.NOTION, "notion-2", "Home"),
        api.layer,
      );
      assert.ok("account" in renamed);
      assert.equal(renamed.account.label, "Home");
      assert.deepEqual(
        api.requests().map((request) => request.search),
        ["", "?add=true", "?connection=notion-2"],
      );
    }),
);
