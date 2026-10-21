/**
 * base.test.ts -- the caller middlewares, as a route answers through them.
 *
 * The caller middlewares as a route answers through them: the bearer-only
 * caller is refused when only a cookie could name it, whatever the resolver
 * would have said, and the session caller is answered with the one
 * credential that carries its session on, refused as unauthenticated where
 * the auth service names nobody or the request carries no credential at
 * all, and as unavailable where the auth service could not answer. Over
 * Better Auth with the bearer plugin as `auth.ts` installs it, on a PGlite of
 * its own, a session is read from an `Authorization` alone wherever one is
 * carried, so a bearer the plugin did not sign is never read past to the
 * cookie beside it.
 *
 * Synthetic accounts, bearers, and sessions throughout.
 */

import "@orpc/experimental-effect/extensions/effect";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { HOSTED_ERRORS } from "@luke/features/contract";
import { HTTP_METHOD } from "@luke/wire";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { implement } from "@orpc/server";
import { Cause, Context, Effect, Option, Schema } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import type { SessionUserIdResolver, UserIdResolver } from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { bearerOnlyMiddleware, type HostedContext, sessionMiddleware } from "./base.js";
import { hostedFetch } from "./handler.js";

const ORIGIN = "https://luke.test";
const BEARER_PATH = "/api/test/bearer";
const SESSION_PATH = "/api/test/session";
const USER_ID = "user-1";

/** The caller a procedure was handed, and every header carried on to the plugin with its session. */
const callerSchema = Schema.Struct({
  userId: Schema.String,
  carried: Schema.Record(Schema.String, Schema.String),
});

const callerContract = {
  bearer: oc
    .errors(HOSTED_ERRORS)
    .meta(openapi({ method: HTTP_METHOD.GET, path: BEARER_PATH }))
    .output(Schema.flip(callerSchema)),
  session: oc
    .errors(HOSTED_ERRORS)
    .meta(openapi({ method: HTTP_METHOD.GET, path: SESSION_PATH }))
    .output(Schema.flip(callerSchema)),
};

const callers = implement(callerContract).$context<HostedContext>();

/** A resolver that names the test's account for any request at all. */
const everyone: UserIdResolver = () => Effect.succeed(Option.some(USER_ID));

function routerOver(session: SessionUserIdResolver) {
  return callers.router({
    bearer: callers.bearer
      .use(bearerOnlyMiddleware(everyone))
      .handler(({ context }) => ({ userId: context.userId, carried: {} })),
    session: callers.session.use(sessionMiddleware(session)).handler(({ context }) => ({
      userId: context.userId,
      carried: Object.fromEntries(context.sessionHeaders),
    })),
  });
}

const answer = (session: SessionUserIdResolver, path: string, headers: Record<string, string>) =>
  Effect.gen(function* () {
    // SAFETY: the test procedures yield no service, so an empty context stands in for the web runtime's.
    const services = Context.empty() as Context.Context<WebServices>;
    const response = yield* Effect.promise(() =>
      hostedFetch(routerOver(session))(new Request(`${ORIGIN}${path}`, { headers }), services),
    );
    return { status: response.status, text: yield* Effect.promise(() => response.text()) };
  });

const sessionOf: SessionUserIdResolver = (request) =>
  Effect.succeed(Option.fromNullishOr(request.headers.has("cookie") ? USER_ID : undefined));

const UNAUTHENTICATED = {
  status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  text: '{"error":"invalid-token"}',
} as const;

/**
 * Two accounts on Better Auth over its own PGlite, each signed in on a
 * browser of its own, and Ada on her Mac too: her session as the signed
 * bearer the plugin hands the Mac.
 */
const openSessions = Effect.gen(function* () {
  const plugin = yield* openWorkspacePlugin;
  const [ada, grace] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  yield* Database.use((db) =>
    db
      .insert(user)
      .values([ada, grace].map((id) => ({ id, name: "Test User", email: `${id}@luke.test` }))),
  ).pipe(Effect.provide(plugin.database));
  return {
    plugin,
    ada,
    adaCookie: yield* plugin.sessionCookieOf(ada),
    adaBearer: `Bearer ${yield* plugin.sessionBearerOf(ada)}`,
    graceCookie: yield* plugin.sessionCookieOf(grace),
  };
});

it.effect(
  "a bearer-only caller is refused when only a cookie could name it, and read by its bearer",
  () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* answer(sessionOf, BEARER_PATH, { cookie: "session=s1" }),
        UNAUTHENTICATED,
      );
      assert.deepEqual(yield* answer(sessionOf, BEARER_PATH, { authorization: "Bearer t" }), {
        status: HOSTED_HTTP_STATUS.OK,
        text: JSON.stringify({ userId: USER_ID, carried: {} }),
      });
    }),
);

it.effect(
  "a session caller is answered with the credential that carries its session, and refused where the auth service names nobody or cannot answer",
  () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* answer(sessionOf, SESSION_PATH, { cookie: "session=s1", origin: ORIGIN }),
        {
          status: HOSTED_HTTP_STATUS.OK,
          text: JSON.stringify({ userId: USER_ID, carried: { cookie: "session=s1" } }),
        },
      );
      const nobody: SessionUserIdResolver = () => Effect.succeedNone;
      assert.deepEqual(
        yield* answer(nobody, SESSION_PATH, { cookie: "session=s1" }),
        UNAUTHENTICATED,
      );
      const down: SessionUserIdResolver = () =>
        Effect.fail(new Cause.UnknownError("the auth service is down"));
      assert.deepEqual(yield* answer(down, SESSION_PATH, { cookie: "session=s1" }), {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        text: '{"error":"unavailable"}',
      });
    }),
);

it.effect(
  "a request carrying no credential, or only a blank one, is refused as unauthenticated without asking the auth service",
  () =>
    Effect.gen(function* () {
      // A session read that names anyone, and one that is down, so a refusal is unauthenticated only where neither was asked.
      const anyone: SessionUserIdResolver = () => Effect.succeedSome(USER_ID);
      const down: SessionUserIdResolver = () =>
        Effect.fail(new Cause.UnknownError("the auth service is down"));
      for (const headers of [{}, { cookie: "" }, { cookie: "   " }, { origin: ORIGIN }]) {
        for (const session of [anyone, down]) {
          assert.deepEqual(
            yield* answer(session, SESSION_PATH, headers),
            UNAUTHENTICATED,
            JSON.stringify(headers),
          );
        }
      }
    }),
);

it.effect(
  "an Authorization the auth service did not sign is nobody, never the session the cookie beside it names",
  () =>
    Effect.gen(function* () {
      const { plugin, ada, adaCookie } = yield* openSessions;
      const junk = "Bearer not-a-token";

      // The hazard: Better Auth's bearer plugin leaves the cookie standing under a bearer it did not sign.
      assert.deepEqual(
        yield* plugin.resolveSessionUserId({
          headers: new Headers({ authorization: junk, cookie: adaCookie }),
        }),
        Option.some(ada),
      );
      for (const authorization of [junk, "Basic YWRhOmxvdmVsYWNl", ""]) {
        assert.deepEqual(
          yield* answer(plugin.resolveSessionUserId, SESSION_PATH, {
            authorization,
            cookie: adaCookie,
          }),
          UNAUTHENTICATED,
          JSON.stringify(authorization),
        );
      }
    }),
);

it.effect(
  "the Mac's session bearer and a browser's cookie are each the account they name, carried on to the plugin with nothing beside them",
  () =>
    Effect.gen(function* () {
      const { plugin, ada, adaCookie, adaBearer, graceCookie } = yield* openSessions;

      assert.deepEqual(
        yield* answer(plugin.resolveSessionUserId, SESSION_PATH, {
          cookie: adaCookie,
          origin: ORIGIN,
        }),
        {
          status: HOSTED_HTTP_STATUS.OK,
          text: JSON.stringify({ userId: ada, carried: { cookie: adaCookie } }),
        },
      );
      assert.deepEqual(
        yield* answer(plugin.resolveSessionUserId, SESSION_PATH, {
          authorization: adaBearer,
          cookie: graceCookie,
        }),
        {
          status: HOSTED_HTTP_STATUS.OK,
          text: JSON.stringify({ userId: ada, carried: { authorization: adaBearer } }),
        },
        "the Mac's own session, whatever session a cookie beside it names",
      );
    }),
);
