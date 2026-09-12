import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedChangesClient } from "./changes-client.js";
import { encodeSequenceReadCursor } from "./reads-wire.js";

const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const EMPTY_CURSOR = encodeSequenceReadCursor([]);

function client(options: Partial<ConstructorParameters<typeof HostedChangesClient>[0]> = {}) {
  return new HostedChangesClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    ...options,
  });
}

it.effect(
  "a poll is a bearer-authenticated POST carrying the device and each instant as stated, and reads the heads back",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/changes": {
          answer: () => ({ seen: true, messages: EMPTY_CURSOR, events: EMPTY_CURSOR }),
        },
      });

      const answer = yield* Effect.provide(
        client().poll({
          deviceId: DEVICE_ID,
          activeUntil: 1_757_505_900_000,
          quietUntil: null,
        }),
        api.layer,
      );

      assert.deepEqual(answer, { seen: true, messages: EMPTY_CURSOR, events: EMPTY_CURSOR });
      assert.deepEqual(recordedRoutes(api.requests()), ["POST /api/changes"]);
      assert.deepEqual(api.credentials(), ["token-1"]);
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        deviceId: DEVICE_ID,
        activeUntil: 1_757_505_900_000,
        quietUntil: null,
      });
    }),
);

it.effect("an instant left out travels as left out, so the service leaves the one on file", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/changes": {
        answer: () => ({ seen: false, messages: EMPTY_CURSOR, events: EMPTY_CURSOR }),
      },
    });

    const answer = yield* Effect.provide(client().poll({ deviceId: DEVICE_ID }), api.layer);

    assert.equal(answer?.seen, false);
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { deviceId: DEVICE_ID });
  }),
);

it.effect(
  "a request the service would refuse by shape never travels, and a malformed answer reads as nothing",
  () =>
    Effect.gen(function* () {
      const refused = fakeCloudApi({});
      assert.equal(
        yield* Effect.provide(client().poll({ deviceId: "mac", activeUntil: 1 }), refused.layer),
        undefined,
      );
      assert.deepEqual(refused.requests(), []);

      const malformed = fakeCloudApi({
        "POST /api/changes": { answer: () => ({ seen: "yes" }) },
      });
      assert.equal(
        yield* Effect.provide(client().poll({ deviceId: DEVICE_ID }), malformed.layer),
        undefined,
      );
      assert.equal(malformed.requests().length, 1);
    }),
);
