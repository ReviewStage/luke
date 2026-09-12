import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import {
  fakeCloudApi,
  HTTP_STATUS,
  jsonResponse,
  recordedRoutes,
  recordingFetch,
} from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedDeviceClient } from "./device-client.js";
import { DEVICE_PLATFORM } from "./device-wire.js";

const INSTALLATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function client(
  httpClient: ReturnType<typeof fakeCloudApi>["layer"],
  options: Partial<ConstructorParameters<typeof HostedDeviceClient>[0]> = {},
) {
  return new HostedDeviceClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: async () => "token-1",
    refreshAccount: () => Effect.void,
    httpClient,
    ...options,
  });
}

it.effect("registers the installation as a bearer-authenticated POST and reads the device id", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/devices": { answer: () => ({ deviceId: DEVICE_ID }) },
    });

    const answer = yield* Effect.promise(() =>
      client(api.layer).register({
        platform: DEVICE_PLATFORM.MACOS,
        installationId: INSTALLATION_ID,
      }),
    );

    assert.deepEqual(answer, { deviceId: DEVICE_ID });
    assert.deepEqual(recordedRoutes(api.requests()), ["POST /api/devices"]);
    assert.deepEqual(api.credentials(), ["token-1"]);
    const [request] = api.requests();
    assert.equal(request?.contentType, "application/json");
    assert.deepEqual(JSON.parse(request?.body ?? "{}"), {
      platform: DEVICE_PLATFORM.MACOS,
      installationId: INSTALLATION_ID,
    });
  }),
);

it.effect("a request the service would refuse by shape never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});
    const devices = client(api.layer);

    assert.equal(
      yield* Effect.promise(() =>
        devices.register({ platform: DEVICE_PLATFORM.MACOS, installationId: "mac-1" }),
      ),
      undefined,
    );
    assert.equal(
      yield* Effect.promise(() =>
        devices.register({
          platform: DEVICE_PLATFORM.IOS,
          installationId: INSTALLATION_ID,
          pushToken: "ab".repeat(32),
        }),
      ),
      undefined,
    );
    assert.equal(yield* Effect.promise(() => devices.forget({ deviceId: "" })), undefined);
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("a forget is a DELETE naming the device and reads whether a row went", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "DELETE /api/devices": { answer: () => ({ deleted: false }) },
    });

    const answer = yield* Effect.promise(() => client(api.layer).forget({ deviceId: DEVICE_ID }));

    assert.deepEqual(answer, { deleted: false });
    assert.deepEqual(recordedRoutes(api.requests()), ["DELETE /api/devices"]);
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { deviceId: DEVICE_ID });
  }),
);

it.effect("a forget at sign-out carries the departing token and never refreshes", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "DELETE /api/devices": {
        answer: () => ({ error: "invalid-token" }),
        status: HTTP_STATUS.UNAUTHORIZED,
      },
    });
    let refreshes = 0;

    const answer = yield* Effect.promise(() =>
      client(api.layer, {
        readAccessToken: async () => "token-standing",
        refreshAccount: () =>
          Effect.sync(() => {
            refreshes += 1;
          }),
      }).forget({ deviceId: DEVICE_ID }, { accessToken: "token-departing" }),
    );

    assert.equal(answer, undefined);
    assert.equal(refreshes, 0);
    assert.deepEqual(api.credentials(), ["token-departing"]);
  }),
);

it.effect("a 401 refreshes the account and retries once on the new token", () =>
  Effect.gen(function* () {
    const tokens = ["token-1", "token-2"];
    let refreshes = 0;
    // The status moves between the two attempts, which a fake route's own
    // fixed status cannot express, so this one recording answers by hand.
    const { requests, fetch } = recordingFetch((request) =>
      request.authorization === "Bearer token-2"
        ? jsonResponse({ deviceId: DEVICE_ID })
        : jsonResponse({ error: "invalid-token" }, HTTP_STATUS.UNAUTHORIZED),
    );

    const answer = yield* Effect.promise(() =>
      client(layerFromCloudFetch(fetch), {
        readAccessToken: async () => tokens.shift(),
        refreshAccount: () =>
          Effect.sync(() => {
            refreshes += 1;
          }),
      }).register({ platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID }),
    );

    assert.deepEqual(answer, { deviceId: DEVICE_ID });
    assert.equal(refreshes, 1);
    assert.deepEqual(
      requests.map((request) => request.authorization),
      ["Bearer token-1", "Bearer token-2"],
    );
  }),
);

it.effect("a refusal, a malformed answer, or no token resolves to nothing", () =>
  Effect.gen(function* () {
    const refused = fakeCloudApi({
      "DELETE /api/devices": {
        answer: () => ({ error: "invalid-request" }),
        status: HTTP_STATUS.BAD_REQUEST,
      },
    });
    assert.equal(
      yield* Effect.promise(() => client(refused.layer).forget({ deviceId: DEVICE_ID })),
      undefined,
    );

    const malformed = fakeCloudApi({
      "POST /api/devices": { answer: () => ({ deviceId: 7 }) },
    });
    assert.equal(
      yield* Effect.promise(() =>
        client(malformed.layer).register({
          platform: DEVICE_PLATFORM.MACOS,
          installationId: INSTALLATION_ID,
        }),
      ),
      undefined,
    );

    const signedOut = fakeCloudApi({});
    assert.equal(
      yield* Effect.promise(() =>
        client(signedOut.layer, { readAccessToken: async () => undefined }).forget({
          deviceId: DEVICE_ID,
        }),
      ),
      undefined,
    );
    assert.deepEqual(signedOut.requests(), []);
  }),
);
