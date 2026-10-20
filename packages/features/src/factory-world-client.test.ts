import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@luke/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import { HostedFactoryWorldClient } from "./factory-world-client.js";
import { FACTORY_WORLD_CALL_FAILURE } from "./factory-world-view.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * The window's read of a workspace's Factory world against a scripted
 * service: it travels under the account's bearer with the workspace in its
 * body, the world or the null of a workspace with nothing to draw is
 * answered as the service said it, a workspace the account does not reach
 * is named not found, anything else is unanswered, as is a request the
 * service would refuse by shape. Synthetic ids and names.
 */

const WORLD_ROUTE = "POST /api/factory/world";
const WORKSPACE_ID = "workspace-1";

const WORLD = {
  snapshotAt: 2_000,
  shippedSince: 1_000,
  repository: { fullName: "acme/relay", defaultBranch: "main" },
  zones: [{ path: ".", label: "acme/relay", files: 3, bytes: 120, dependsOn: [] }],
  agents: [],
  shipped: [],
  planned: [],
  defects: [],
};

function client(): HostedFactoryWorldClient {
  return new HostedFactoryWorldClient({
    serviceBaseUrl: "https://tryluke.dev",
    requestTimeoutMs: 10_000,
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
      readAccountKey: () => Effect.succeed("ada@example.com"),
    }),
  });
}

it.effect(
  "the world travels under the account's bearer with its workspace, and is answered as the service drew it, null where nothing is drawn",
  () =>
    Effect.gen(function* () {
      const worlds = [WORLD, null];
      const api = fakeCloudApi({ [WORLD_ROUTE]: { answer: () => ({ world: worlds.shift() }) } });
      const ask = client();

      const drawn = yield* Effect.provide(ask.world({ workspaceId: WORKSPACE_ID }), api.layer);
      const bare = yield* Effect.provide(ask.world({ workspaceId: WORKSPACE_ID }), api.layer);

      assert.deepEqual(drawn, { world: WORLD });
      assert.deepEqual(bare, { world: null });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { workspaceId: WORKSPACE_ID });
      assert.deepEqual(api.credentials(), ["token-1", "token-1"]);
    }),
);

it.effect(
  "a workspace out of reach is named not found, any other refusal or an answer that is no world is unanswered, and so is a request with no workspace",
  () =>
    Effect.gen(function* () {
      const refusing = (status: number, error: string) =>
        fakeCloudApi({ [WORLD_ROUTE]: { answer: () => ({ error }), status } });
      const notFound = refusing(HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
      const unavailable = refusing(HTTP_STATUS.SERVER_ERROR, HOSTED_API_ERROR.UNAVAILABLE);
      const malformed = fakeCloudApi({
        [WORLD_ROUTE]: { answer: () => ({ world: { repository: "not a world" } }) },
      });
      const ask = client();
      const asked = { workspaceId: WORKSPACE_ID };

      const gone = yield* Effect.provide(ask.world(asked), notFound.layer);
      const down = yield* Effect.provide(ask.world(asked), unavailable.layer);
      const unread = yield* Effect.provide(ask.world(asked), malformed.layer);
      const unnamed = yield* Effect.provide(ask.world({ workspaceId: "" }), malformed.layer);

      assert.deepEqual(gone, { failure: FACTORY_WORLD_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(down, { failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(unread, { failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(unnamed, { failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED });
    }),
);
