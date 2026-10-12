import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { HostedWorkspaceClient } from "./workspace-client.js";

const PERSONAL = { id: "org-personal-1", name: "Ada Lovelace", personal: true };
const SHARED = { id: "org-acme-1", name: "Acme", personal: false };

function client(): HostedWorkspaceClient {
  return new HostedWorkspaceClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("lists the account's workspaces under its bearer, as the service ordered them", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/workspaces": { answer: () => ({ workspaces: [PERSONAL, SHARED] }) },
    });

    const read = yield* Effect.provide(client().list(), api.layer);

    assert.deepEqual(read, [PERSONAL, SHARED]);
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect("reads a key a newer service added past, and a refusal or a malformed list as none", () =>
  Effect.gen(function* () {
    const newer = fakeCloudApi({
      "GET /api/workspaces": {
        answer: () => ({ workspaces: [{ ...PERSONAL, logo: null }], cursor: "next" }),
      },
    });
    const refusing = fakeCloudApi({
      "GET /api/workspaces": {
        answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
        status: HTTP_STATUS.SERVER_ERROR,
      },
    });
    const malformed = fakeCloudApi({
      "GET /api/workspaces": { answer: () => ({ workspaces: [{ ...SHARED, id: "" }] }) },
    });

    assert.deepEqual(yield* Effect.provide(client().list(), newer.layer), [PERSONAL]);
    assert.equal(yield* Effect.provide(client().list(), refusing.layer), undefined);
    assert.equal(yield* Effect.provide(client().list(), malformed.layer), undefined);
  }),
);
