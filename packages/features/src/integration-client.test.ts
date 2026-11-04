import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi } from "@repo/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import { HostedIntegrationsClient } from "./integration-client.js";
import { INTEGRATION_PROVIDER } from "./integration-wire.js";

/**
 * The account's integrations as the host asks the service about one
 * account: a call about an account other than a provider's first names it
 * in the query, and a Connect that adds one says so.
 */

const client = new HostedIntegrationsClient({
  serviceBaseUrl: "https://vespin.dev",
  credential: accountBearer({
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("ada@example.com"),
  }),
});

it.effect(
  "a call about one account names it in the query, and a Connect that adds one says so",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
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
        ["?add=true", "?connection=notion-2"],
      );
    }),
);
