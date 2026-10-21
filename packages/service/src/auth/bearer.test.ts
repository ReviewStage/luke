import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { session, user } from "@luke/database/schemas/auth";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { repositoryPinsAnswerSchema } from "@luke/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { type Context, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { repositoryPinsProcedures } from "../github/repository-pins-procedures.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import type { UserIdResolver } from "../http/http-effect.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { auth } from "./auth.js";
import { SESSION_COOKIE_CACHE } from "./auth-policy.js";
import {
  hostedUserId,
  requestUserId,
  resolveHostedBearerUserId,
  resolveHostedUserId,
  type SessionEndpoint,
  type UserInfoEndpoint,
} from "./bearer.js";
import { BEARER_CALLER_TTL, bearerCallersLayer } from "./bearer-callers.js";

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

/** A secret no deployment of this suite signs under. */
const FOREIGN_SECRET = "another-deployment-secret-with-enough-length";

/** Another account's OAuth token, for the faked auth service. */
const GRACE_BEARER = "Bearer oauth-token-of-grace";

/** A userinfo endpoint that knows no token. */
const NO_TOKEN: UserInfoEndpoint = () => Effect.succeed(undefined);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/voice/mint", { method: "POST", headers });
}

/**
 * The deployment's auth service, faked at its boundary: Better Auth's own
 * userinfo answers the subject each token it holds names, and refuses any
 * other as it refuses an unknown or revoked one. A test issues and revokes
 * tokens on `tokens` as it goes; with `revokeAsAnswered`, a token is revoked
 * the moment it is answered, so only the first ask for it ever names anyone.
 */
function fakeAuthService(tokens: Map<string, string>, revokeAsAnswered = false) {
  vi.spyOn(auth.api, "oauth2UserInfo").mockImplementation(
    // SAFETY: `hostedUserInfo` reads `sub` alone, which the fake answers as the endpoint does.
    (async (context: { headers: Headers }) => {
      const authorization = context.headers.get("authorization") ?? "";
      const sub = tokens.get(authorization);
      if (sub === undefined) throw new Error("invalid_token");
      if (revokeAsAnswered) tokens.delete(authorization);
      return { sub };
    }) as unknown as typeof auth.api.oauth2UserInfo,
  );
}

/** The account a bearer names, resolved as the Mac's held read resolves it, on the instance's kept callers. */
const bearerUserId = (authorization: string) =>
  resolveHostedBearerUserId(request({ authorization }));

/** A read of an account route carrying the headers given. */
function read(headers: Record<string, string>): Request {
  return new Request(new URL(HOSTED_SERVICE_PATH.REPOSITORY_PINS, ORIGIN), { headers });
}

/**
 * The cookie given, naming the same session but signed under a secret the
 * deployment never held: a signature as well formed as the deployment's own.
 */
const signedElsewhere = (cookie: string) =>
  Effect.promise(async () => {
    const at = cookie.indexOf("=");
    const signed = decodeURIComponent(cookie.slice(at + 1));
    const token = signed.slice(0, signed.lastIndexOf("."));
    const forged = `${token}.${await makeSignature(token, FOREIGN_SECRET)}`;
    return `${cookie.slice(0, at)}=${encodeURIComponent(forged)}`;
  });

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

/** The repositories one request to the pins resource answers as pinned, failing the test where it answers anything else. */
const pinnedBy = (resolveUserId: UserIdResolver, request: Request) =>
  Effect.gen(function* () {
    // The procedure runs on the services handed to it, the test's clock among them: a pin's instant is read from it.
    // SAFETY: the pins procedures yield the database and the clock alone, which the test's own context holds.
    const services = (yield* Effect.context<never>()) as Context.Context<WebServices>;
    const handle = hostedFetch({ repositoryPins: repositoryPinsProcedures({ resolveUserId }) });
    const response = yield* Effect.promise(() => handle(request, services));
    // SAFETY: the route answers JSON; the test reads it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
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
      yield* resolveUserId(read({ cookie: yield* signedElsewhere(adaCookie) })),
      Option.none(),
      "Ada's own session, signed under a secret the deployment never held",
    );
  }),
);

it.effect("a request with no cookie, or a blank one, asks the auth service for no session", () =>
  Effect.gen(function* () {
    // A session read that names anyone, so a resolution names nobody only where it never asked.
    const anyone: SessionEndpoint = () => Effect.succeedSome("user-anyone");

    for (const headers of [{}, { cookie: "" }, { cookie: "   " }]) {
      assert.deepEqual(
        yield* requestUserId(read(headers), NO_TOKEN, anyone),
        Option.none(),
        JSON.stringify(headers),
      );
    }
  }),
);

it.effect("a session read the auth service fails resolves nobody, as a failed userinfo does", () =>
  Effect.gen(function* () {
    const failing: SessionEndpoint = () =>
      Effect.tryPromise(() => Promise.reject(new Error("the auth service is down")));

    assert.deepEqual(
      yield* requestUserId(read({ cookie: "better-auth.session_token=any" }), NO_TOKEN, failing),
      Option.none(),
    );
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
  "the bearer resolutions the Mac's commands and eve's channels take never read the session a cookie names",
  () =>
    Effect.gen(function* () {
      const { plugin, ada, adaCookie, userInfo } = yield* openAccounts;
      // The deployment's auth service keeps its sessions in a database this suite never reaches, so it reads a cookie as the plugin over PGlite does.
      vi.spyOn(auth.api, "getSession").mockImplementation(
        // SAFETY: the resolvers read the session's user id alone, which both instances answer from the same row.
        async (context) =>
          (await plugin.api.getSession({ headers: context?.headers ?? new Headers() })) as Awaited<
            ReturnType<typeof auth.api.getSession>
          >,
      );
      const cookieOnly = read({ cookie: adaCookie });

      assert.deepEqual(
        yield* resolveHostedUserId(cookieOnly),
        Option.some(ada),
        "the account routes' resolution takes the cookie",
      );
      assert.deepEqual(yield* resolveHostedBearerUserId(cookieOnly), Option.none());
      assert.deepEqual(yield* hostedUserId(cookieOnly, userInfo), Option.none());
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
            headers: { cookie, "content-type": "application/json" },
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

it.effect(
  "a bearer resolved within the TTL is answered by the instance, and asked afresh after it",
  () =>
    Effect.gen(function* () {
      const tokens = new Map([[ADA_BEARER, "user-ada"]]);
      fakeAuthService(tokens, true);

      assert.deepEqual(yield* bearerUserId(ADA_BEARER), Option.some("user-ada"));
      // The trade-off: the token, revoked as it was answered, still resolves on this instance until its TTL runs out.
      assert.deepEqual(yield* bearerUserId(ADA_BEARER), Option.some("user-ada"));
      yield* TestClock.adjust(BEARER_CALLER_TTL);
      assert.deepEqual(yield* bearerUserId(ADA_BEARER), Option.none());
    }).pipe(Effect.provide(bearerCallersLayer)),
);

it.effect("requests for one bearer that miss together share the one ask", () =>
  Effect.gen(function* () {
    const tokens = new Map([[ADA_BEARER, "user-ada"]]);
    fakeAuthService(tokens, true);

    const resolved = yield* Effect.all(
      Array.from({ length: 5 }, () => bearerUserId(ADA_BEARER)),
      { concurrency: "unbounded" },
    );
    assert.deepEqual(
      resolved,
      Array.from({ length: 5 }, () => Option.some("user-ada")),
    );
  }).pipe(Effect.provide(bearerCallersLayer)),
);

it.effect("a refused bearer is asked again every time, so a token issued since works at once", () =>
  Effect.gen(function* () {
    const tokens = new Map<string, string>();
    fakeAuthService(tokens);

    assert.deepEqual(yield* bearerUserId(ADA_BEARER), Option.none());
    tokens.set(ADA_BEARER, "user-ada");
    assert.deepEqual(yield* bearerUserId(ADA_BEARER), Option.some("user-ada"));
  }).pipe(Effect.provide(bearerCallersLayer)),
);

it.effect("two bearers never answer for each other on one instance", () =>
  Effect.gen(function* () {
    const tokens = new Map([
      [ADA_BEARER, "user-ada"],
      [GRACE_BEARER, "user-grace"],
    ]);
    fakeAuthService(tokens, true);

    // The second round is answered from what the instance kept, the auth service having revoked both as it answered.
    for (const _round of [1, 2]) {
      assert.deepEqual(yield* bearerUserId(ADA_BEARER), Option.some("user-ada"));
      assert.deepEqual(yield* bearerUserId(GRACE_BEARER), Option.some("user-grace"));
      assert.deepEqual(yield* bearerUserId("Bearer oauth-token-of-nobody"), Option.none());
    }
  }).pipe(Effect.provide(bearerCallersLayer)),
);

it.effect(
  "a browser's session reads from its cookie cache for at most the cache's age after it is revoked",
  () =>
    Effect.gen(function* () {
      // Better Auth reads the instant off `Date`, so the test holds that clock alone.
      vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 20) });
      const { plugin, ada, adaCookie, resolveUserId } = yield* openAccounts;
      const minted = yield* Effect.promise(() =>
        plugin.api.getSession({ headers: new Headers({ cookie: adaCookie }), returnHeaders: true }),
      );
      const cached = minted.headers
        .getSetCookie()
        .map((cookie) => cookie.slice(0, cookie.indexOf(";")))
        .find((cookie) => cookie.includes("session_data="));
      assert.ok(cached, "a session read hands the browser its cache cookie");
      yield* Database.use((db) => db.delete(session).where(eq(session.userId, ada))).pipe(
        Effect.provide(plugin.database),
      );
      const withCache = read({ cookie: `${adaCookie}; ${cached}` });

      assert.deepEqual(yield* resolveUserId(read({ cookie: adaCookie })), Option.none());
      assert.deepEqual(yield* resolveUserId(withCache), Option.some(ada));
      vi.advanceTimersByTime(SESSION_COOKIE_CACHE.cookieCache.maxAge * 1000 + 1);
      assert.deepEqual(yield* resolveUserId(withCache), Option.none());
    }),
);
