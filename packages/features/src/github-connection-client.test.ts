import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@luke/wire/testing";
import { Effect } from "effect";
import { accountBearer, sessionBearer } from "./account-call.js";
import type { AccountSessionToken } from "./account-token.js";
import {
  GITHUB_CONNECTION_CALL_FAILURE,
  HostedGitHubConnectionClient,
} from "./github-connection-client.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const CONNECT_PAGE = "https://tryluke.dev/connect-github.html?intent=opaque-intent-1";

/** The client over an account holding OAuth token `token-1` and, unless told otherwise, session `session-1`. */
function client(
  session: AccountSessionToken = {
    readSessionToken: () => Effect.succeed("session-1"),
    obtainSession: () => Effect.void,
  },
): HostedGitHubConnectionClient {
  const token = {
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("ada@example.com"),
  };
  return new HostedGitHubConnectionClient({
    serviceBaseUrl: "https://tryluke.dev",
    credential: accountBearer(token),
    sessionCredential: sessionBearer({ ...token, ...session }),
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

it.effect(
  "disconnects under the Mac's session, never its OAuth token, and answers the connection as it then stands",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/github/disconnect": { answer: () => ({ connected: false, login: null }) },
      });

      const disconnected = yield* Effect.provide(client().disconnect(), api.layer);

      assert.deepEqual(disconnected, { ok: true, answer: { connected: false, login: null } });
      assert.deepEqual(api.credentials(), ["session-1"]);
    }),
);

it.effect(
  "with no session yet, a disconnect asks for one through the hand-off and is sent on it",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/github/disconnect": { answer: () => ({ connected: false, login: null }) },
      });
      let session: string | undefined;
      const handedOff = client({
        readSessionToken: () => Effect.sync(() => session),
        obtainSession: () =>
          Effect.sync(() => {
            session = "session-2";
          }),
      });

      yield* Effect.provide(handedOff.disconnect(), api.layer);

      assert.deepEqual(api.credentials(), ["session-2"]);
    }),
);

it.effect("GitHub as the only sign-in is named, and any other refusal is unanswered", () =>
  Effect.gen(function* () {
    const lastSignIn = fakeCloudApi({
      "POST /api/github/disconnect": {
        answer: () => ({ error: HOSTED_API_ERROR.NOT_PERMITTED }),
        status: HTTP_STATUS.FORBIDDEN,
      },
    });
    const broken = fakeCloudApi({
      "POST /api/github/disconnect": {
        answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
        status: HTTP_STATUS.SERVER_ERROR,
      },
    });

    assert.deepEqual(yield* Effect.provide(client().disconnect(), lastSignIn.layer), {
      ok: false,
      failure: GITHUB_CONNECTION_CALL_FAILURE.NOT_PERMITTED,
    });
    assert.deepEqual(yield* Effect.provide(client().disconnect(), broken.layer), {
      ok: false,
      failure: GITHUB_CONNECTION_CALL_FAILURE.UNANSWERED,
    });
  }),
);
