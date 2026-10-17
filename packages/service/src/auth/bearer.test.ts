import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { repositoryPinsAnswerSchema } from "@luke/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { repositoryPinsApp } from "../github/repository-pins-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import type { UserIdResolver } from "../http/http-effect.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { hostedUserId, requestUserId, type UserInfoEndpoint } from "./bearer.js";

/**
 * The account a hosted request names: its OAuth bearer where it carries
 * `Authorization`, and only where it carries none, the browser's session
 * cookie, read by Better Auth with the bearer plugin as `auth.ts` installs
 * it, over a PGlite of its own. The userinfo endpoint is a fake that knows
 * one OAuth token. That a state-changing request's cookie is held to the
 * deployment's own pages first is the adaptor's to prove
 * (`apps/web/tests/cookie-session.test.ts`).
 *
 * Synthetic accounts, tokens, and sessions throughout.
 */

const ORIGIN = "https://luke.test";

/** The one OAuth token the fake userinfo endpoint knows: Ada's. */
const ADA_BEARER = "Bearer oauth-token-of-ada";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/voice/mint", { method: "POST", headers });
}

/** A read of an account route carrying the headers given. */
function read(headers: Record<string, string>): Request {
  return new Request(new URL(HOSTED_SERVICE_PATH.REPOSITORY_PINS, ORIGIN), { headers });
}

/**
 * Two accounts on Better Auth over its own PGlite, each signed in on a
 * browser of its own, and the request's account resolved as
 * `resolveHostedUserId` resolves it, the plugin's session read standing in
 * for the deployment's.
 */
const openAccounts = Effect.gen(function* () {
  const plugin = yield* openWorkspacePlugin;
  const [ada, grace] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  yield* Database.use((db) =>
    db
      .insert(user)
      .values([ada, grace].map((id) => ({ id, name: "Test User", email: `${id}@luke.test` }))),
  ).pipe(Effect.provide(plugin.database));
  const userInfo: UserInfoEndpoint = (input) =>
    Effect.succeed(input.headers.get("authorization") === ADA_BEARER ? { sub: ada } : undefined);
  const resolveUserId: UserIdResolver = (incoming) =>
    requestUserId(incoming, userInfo, plugin.resolveSessionUserId);
  return {
    plugin,
    ada,
    grace,
    userInfo,
    resolveUserId,
    adaCookie: yield* plugin.sessionCookieOf(ada),
    graceCookie: yield* plugin.sessionCookieOf(grace),
  };
});

/** The repositories one request to the pins group answers as pinned, failing the test where it answers anything else. */
const pinnedBy = (resolveUserId: UserIdResolver, request: Request) =>
  Effect.gen(function* () {
    // The handler runs on the router's own fiber, so it is handed the test's clock: a pin's instant is read from it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      repositoryPinsApp({ resolveUserId }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test reads it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    assert.equal(response.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(body));
    const answered = readEither(repositoryPinsAnswerSchema)(unparsedWire(body));
    if (Result.isFailure(answered))
      return assert.fail(`not the wire's: ${answered.failure.refusal}`);
    return answered.success.pins.map((pin) => pin.repository);
  });

it.effect(
  "a request without a bearer header resolves nobody and asks the auth service nothing",
  () =>
    Effect.gen(function* () {
      let asked = 0;
      const userId = yield* hostedUserId(request(), () => {
        asked += 1;
        return Effect.succeed({ sub: "user-1" });
      });
      assert.deepEqual(userId, Option.none());
      assert.equal(asked, 0);
    }),
);

it.effect("a valid token resolves to the auth service's own subject", () =>
  Effect.gen(function* () {
    let forwarded: string | null = null;
    const userId = yield* hostedUserId(request({ authorization: "Bearer token-1" }), (input) => {
      forwarded = input.headers.get("authorization");
      return Effect.succeed({ sub: "user-1", email: "dev@example.com" });
    });
    assert.deepEqual(userId, Option.some("user-1"));
    assert.equal(forwarded, "Bearer token-1");
  }),
);

it.effect("a rejected, malformed, or subjectless answer is one indistinguishable no", () =>
  Effect.gen(function* () {
    const rejected = yield* hostedUserId(request({ authorization: "Bearer expired" }), () =>
      Effect.tryPromise(() => Promise.reject(new Error("invalid_token"))),
    );
    assert.deepEqual(rejected, Option.none());

    const malformed = yield* hostedUserId(request({ authorization: "Bearer odd" }), () =>
      Effect.succeed(undefined),
    );
    assert.deepEqual(malformed, Option.none());

    const subjectless = yield* hostedUserId(request({ authorization: "Bearer odd" }), () =>
      Effect.succeed({ sub: "" }),
    );
    assert.deepEqual(subjectless, Option.none());
  }),
);

it.effect("a request with no Authorization is the account its browser session cookie names", () =>
  Effect.gen(function* () {
    const { ada, grace, adaCookie, graceCookie, resolveUserId } = yield* openAccounts;

    assert.deepEqual(yield* resolveUserId(read({ cookie: adaCookie })), Option.some(ada));
    assert.deepEqual(yield* resolveUserId(read({ cookie: graceCookie })), Option.some(grace));
    assert.deepEqual(
      yield* resolveUserId(read({ cookie: "better-auth.session_token=forged.signature" })),
      Option.none(),
    );
    assert.deepEqual(yield* resolveUserId(read({})), Option.none());
  }),
);

it.effect(
  "an OAuth bearer is the account it names, whatever session a cookie beside it names",
  () =>
    Effect.gen(function* () {
      const { ada, graceCookie, resolveUserId } = yield* openAccounts;

      assert.deepEqual(yield* resolveUserId(read({ authorization: ADA_BEARER })), Option.some(ada));
      assert.deepEqual(
        yield* resolveUserId(read({ authorization: ADA_BEARER, cookie: graceCookie })),
        Option.some(ada),
      );
    }),
);

it.effect(
  "an Authorization that does not verify is nobody, never the session the cookie beside it names",
  () =>
    Effect.gen(function* () {
      const { plugin, grace, graceCookie, resolveUserId } = yield* openAccounts;
      const junk = "Bearer not-a-token";

      // The hazard: Better Auth's bearer plugin leaves the cookie standing under a bearer it did not sign.
      assert.deepEqual(
        yield* plugin.resolveSessionUserId({
          headers: new Headers({ authorization: junk, cookie: graceCookie }),
        }),
        Option.some(grace),
      );
      for (const authorization of [junk, "Basic Z3JhY2U6aG9wcGVy", ""]) {
        assert.deepEqual(
          yield* resolveUserId(read({ authorization, cookie: graceCookie })),
          Option.none(),
          JSON.stringify(authorization),
        );
      }
    }),
);

it.effect(
  "the bearer resolution the Mac's commands and eve's channels take never reads a session cookie",
  () =>
    Effect.gen(function* () {
      const { adaCookie, userInfo } = yield* openAccounts;

      assert.deepEqual(yield* hostedUserId(read({ cookie: adaCookie }), userInfo), Option.none());
    }),
);

it.effect(
  "one account's session cookie reads none of another's rows on an account route, and changes only its own",
  () =>
    Effect.gen(function* () {
      const { plugin, adaCookie, graceCookie, resolveUserId } = yield* openAccounts;
      const pins = (cookie: string, change?: { repository: string; pinned: boolean }) =>
        pinnedBy(
          resolveUserId,
          new Request(new URL(HOSTED_SERVICE_PATH.REPOSITORY_PINS, ORIGIN), {
            method: change === undefined ? "GET" : "PUT",
            headers: { cookie },
            ...(change === undefined ? undefined : { body: JSON.stringify(change) }),
          }),
        ).pipe(Effect.provide(plugin.database));

      assert.deepEqual(yield* pins(adaCookie, { repository: "acme/relay", pinned: true }), [
        "acme/relay",
      ]);
      assert.deepEqual(yield* pins(graceCookie), [], "another account's cookie reads none");
      assert.deepEqual(yield* pins(graceCookie, { repository: "acme/relay", pinned: false }), []);
      assert.deepEqual(yield* pins(adaCookie), ["acme/relay"], "and unpins none of them");
    }),
);
