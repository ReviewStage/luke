import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import {
  GITHUB_CONNECTION_CALL_FAILURE,
  HostedGitHubConnectionClient,
} from "./github-connection-client.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const CONNECT_PAGE = "https://tryluke.dev/connect-github.html?intent=opaque-intent-1";

function client(): HostedGitHubConnectionClient {
  return new HostedGitHubConnectionClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("asks for a connect intent under the account's bearer and answers the page to open", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/github/connect": { answer: () => ({ url: CONNECT_PAGE }) },
    });

    const connected = yield* Effect.provide(client().connect(), api.layer);

    assert.deepEqual(connected, { ok: true, answer: { url: CONNECT_PAGE } });
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect("reads the connection, ignoring a key a newer service added", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/github/connection": {
        answer: () => ({ connected: true, login: "octo-dev", since: 1 }),
      },
    });

    const status = yield* Effect.provide(client().status(), api.layer);

    assert.deepEqual(status, { ok: true, answer: { connected: true, login: "octo-dev" } });
  }),
);

it.effect("a refusal or a malformed answer is unanswered rather than a connection", () =>
  Effect.gen(function* () {
    const refusing = fakeCloudApi({
      "GET /api/github/connection": {
        answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
        status: HTTP_STATUS.SERVER_ERROR,
      },
      "POST /api/github/connect": {
        answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
        status: HTTP_STATUS.SERVER_ERROR,
      },
    });
    const malformed = fakeCloudApi({
      "GET /api/github/connection": { answer: () => ({ connected: "yes", login: null }) },
    });
    const unanswered = { ok: false, failure: GITHUB_CONNECTION_CALL_FAILURE.UNANSWERED };

    assert.deepEqual(yield* Effect.provide(client().status(), refusing.layer), unanswered);
    assert.deepEqual(yield* Effect.provide(client().connect(), refusing.layer), unanswered);
    assert.deepEqual(yield* Effect.provide(client().status(), malformed.layer), unanswered);
  }),
);
