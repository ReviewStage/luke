import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CLOUD_AGENT_PROVIDER_ID } from "@sidecar/session";
import { fakeCloudApi, HTTP_STATUS, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedVaultClient } from "./vault-client.js";

const LIST_ANSWER = {
  keys: [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: 1_800_000_000_000 }],
};

function client(
  httpClient: ReturnType<typeof fakeCloudApi>["layer"],
  options: Partial<ConstructorParameters<typeof HostedVaultClient>[0]> = {},
) {
  return new HostedVaultClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    httpClient,
    ...options,
  });
}

it.effect("stores a key as a bearer-authenticated POST and reads the confirmation", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ "POST /api/vault/key": { answer: () => ({ stored: true }) } });

    const answer = yield* Effect.promise(() =>
      client(api.layer).storeKey(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, "key_1234abcd"),
    );

    assert.deepEqual(answer, { stored: true });
    assert.deepEqual(recordedRoutes(api.requests()), ["POST /api/vault/key"]);
    assert.deepEqual(api.credentials(), ["token-1"]);
    const [request] = api.requests();
    assert.equal(request?.contentType, "application/json");
    assert.deepEqual(JSON.parse(request?.body ?? "{}"), {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      key: "key_1234abcd",
    });
  }),
);

it.effect("a key the service would refuse by shape never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});
    const vault = client(api.layer);

    assert.equal(
      yield* Effect.promise(() => vault.storeKey(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, "")),
      undefined,
    );
    assert.equal(
      yield* Effect.promise(() =>
        vault.storeKey(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, "key with spaces"),
      ),
      undefined,
    );
    assert.equal(
      yield* Effect.promise(() =>
        vault.storeKey(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, "k".repeat(513)),
      ),
      undefined,
    );
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("lists stored entries without a body and validates the answer", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ "GET /api/vault/keys": { answer: () => LIST_ANSWER } });

    const keys = yield* Effect.promise(() => client(api.layer).listKeys());

    assert.deepEqual(keys, LIST_ANSWER.keys);
    assert.deepEqual(recordedRoutes(api.requests()), ["GET /api/vault/keys"]);
    const [request] = api.requests();
    assert.equal(request?.body, undefined);
    assert.equal(request?.contentType, undefined);
  }),
);

it.effect("deletes one provider's key and reads whether one was removed", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ "DELETE /api/vault/key": { answer: () => ({ deleted: true }) } });

    const answer = yield* Effect.promise(() =>
      client(api.layer).deleteKey(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR),
    );

    assert.deepEqual(answer, { deleted: true });
    assert.deepEqual(recordedRoutes(api.requests()), ["DELETE /api/vault/key"]);
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
    });
  }),
);

it.effect("a refusal and an answer the vault contract does not admit both read as no answer", () =>
  Effect.gen(function* () {
    const refused = fakeCloudApi({
      "POST /api/vault/key": {
        answer: () => ({ error: "unavailable" }),
        status: HTTP_STATUS.SERVER_ERROR,
      },
    });
    assert.equal(
      yield* Effect.promise(() =>
        client(refused.layer).storeKey(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, "key_1234"),
      ),
      undefined,
    );

    const malformed = fakeCloudApi({
      "GET /api/vault/keys": {
        answer: () => ({ keys: [{ providerId: "openai", updatedAt: 1 }] }),
      },
    });
    assert.equal(yield* Effect.promise(() => client(malformed.layer).listKeys()), undefined);
  }),
);
