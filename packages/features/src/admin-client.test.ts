import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@luke/wire/testing";
import { Effect } from "effect";
import { sessionBearer } from "./account-call.js";
import type { AccountSessionToken } from "./account-token.js";
import { HostedAdminClient } from "./admin-client.js";
import {
  ADMIN_QUERY,
  ADMIN_READ,
  ADMIN_REFUSED,
  ADMIN_ROUTE_PATH,
  ADMIN_UNANSWERED,
} from "./admin-wire.js";

/** One account in the roster the fake service answers. */
const ROSTER = { total: 1, rows: [{ id: "user-ada", name: "Ada" }] };

/** The client over an account holding OAuth token `token-1` and, unless told otherwise, session `session-1`. */
function client(
  session: AccountSessionToken = {
    readSessionToken: () => Effect.succeed("session-1"),
    obtainSession: () => Effect.void,
  },
): HostedAdminClient {
  return new HostedAdminClient({
    serviceBaseUrl: "https://tryluke.dev",
    sessionCredential: sessionBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
      readAccountKey: () => Effect.succeed("ada@example.com"),
      ...session,
    }),
  });
}

const USERS_READ = {
  procedure: ADMIN_READ.USERS,
  query: { [ADMIN_QUERY.WINDOW]: "7", [ADMIN_QUERY.SEARCH]: "ada" },
};

it.effect(
  "a read asks the procedure's route with its query under the session, never the OAuth token, and answers the body as it came",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({ [`GET ${ADMIN_ROUTE_PATH.USERS}`]: { answer: () => ROSTER } });

      const answered = yield* Effect.provide(client().read(USERS_READ), api.layer);

      assert.deepEqual(answered, { answer: ROSTER });
      const [request] = api.requests();
      assert.equal(request?.searchParams.get(ADMIN_QUERY.WINDOW), "7");
      assert.equal(request?.searchParams.get(ADMIN_QUERY.SEARCH), "ada");
      assert.deepEqual(api.credentials(), ["session-1"]);
    }),
);

it.effect(
  "each refusal the admin routes document answers the word a screen tells it apart by, and any other is unanswered",
  () =>
    Effect.gen(function* () {
      const cases = [
        [HTTP_STATUS.FORBIDDEN, ADMIN_REFUSED.FORBIDDEN],
        [HTTP_STATUS.NOT_FOUND, ADMIN_REFUSED.MISSING],
        [503, ADMIN_REFUSED.UNAVAILABLE],
        [500, ADMIN_UNANSWERED],
        [HTTP_STATUS.UNAUTHORIZED, ADMIN_REFUSED.SIGNED_OUT],
      ] as const;
      for (const [status, refused] of cases) {
        const api = fakeCloudApi({
          [`GET ${ADMIN_ROUTE_PATH.USER}`]: { answer: () => ({ error: "refused" }), status },
        });
        const answered = yield* Effect.provide(
          client().read({
            procedure: ADMIN_READ.USER,
            query: { [ADMIN_QUERY.USER_ID]: "user-ada" },
          }),
          api.layer,
        );
        assert.deepEqual(answered, { refused }, `status ${status}`);
      }
    }),
);

it.effect("a Mac holding no session asks for one, then reads under it", () =>
  Effect.gen(function* () {
    let current: string | undefined;
    let asked = 0;
    const api = fakeCloudApi({ [`GET ${ADMIN_ROUTE_PATH.USERS}`]: { answer: () => ROSTER } });

    const answered = yield* Effect.provide(
      client({
        readSessionToken: () => Effect.sync(() => current),
        obtainSession: () =>
          Effect.sync(() => {
            asked += 1;
            current = "session-2";
          }),
      }).read(USERS_READ),
      api.layer,
    );

    assert.deepEqual(answered, { answer: ROSTER });
    assert.equal(asked, 1);
    assert.deepEqual(api.credentials(), ["session-2"]);
  }),
);

it.effect(
  "the star is set with a PUT and taken back with a DELETE naming the account, and answers whether it landed",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`PUT ${ADMIN_ROUTE_PATH.FAVORITE}`]: { answer: () => ({}) },
        [`DELETE ${ADMIN_ROUTE_PATH.FAVORITE}`]: {
          answer: () => ({ error: "user-not-found" }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const set = yield* Effect.provide(client().favorite("user-ada", true), api.layer);
      const takenBack = yield* Effect.provide(client().favorite("user-gone", false), api.layer);

      assert.equal(set, true);
      assert.equal(takenBack, false);
      assert.deepEqual(
        api.requests().map((request) => request.searchParams.get(ADMIN_QUERY.USER_ID)),
        ["user-ada", "user-gone"],
      );
    }),
);
