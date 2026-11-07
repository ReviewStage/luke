import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi } from "@repo/wire/testing";
import { Effect } from "effect";
import { accountBearer, sessionBearer } from "./account-call.js";
import type { AccountSessionToken } from "./account-token.js";
import { HostedGitHubConnectionClient } from "./github-connection-client.js";

const CONNECT_PAGE = "https://vespin.dev/connect-github.html?intent=opaque-intent-1";

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
    serviceBaseUrl: "https://vespin.dev",
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

    assert.deepEqual(connected, { url: CONNECT_PAGE });
    assert.deepEqual(api.credentials(), ["token-1"]);
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

      assert.deepEqual(disconnected, { connected: false, login: null });
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
