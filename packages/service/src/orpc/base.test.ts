/**
 * base.test.ts -- the caller middlewares, as a route answers through them.
 *
 * The caller middlewares as a route answers through them: the bearer-only
 * caller is refused when only a cookie could name it, whatever the resolver
 * would have said, and the session caller is answered with the headers that
 * carry its session on, refused as unauthenticated where the auth service
 * names nobody, and as unavailable where it could not answer.
 */

import "@orpc/experimental-effect/extensions/effect";
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HOSTED_ERRORS } from "@luke/features/contract";
import { HTTP_METHOD } from "@luke/wire";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { implement } from "@orpc/server";
import { Cause, Context, Effect, Option, Schema } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import type { SessionUserIdResolver, UserIdResolver } from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";
import { bearerOnlyMiddleware, type HostedContext, sessionMiddleware } from "./base.js";
import { hostedFetch } from "./handler.js";

const ORIGIN = "https://luke.test";
const BEARER_PATH = "/api/test/bearer";
const SESSION_PATH = "/api/test/session";
const USER_ID = "user-1";

const callerSchema = Schema.Struct({ userId: Schema.String, carried: Schema.String });

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
      .handler(({ context }) => ({ userId: context.userId, carried: "" })),
    session: callers.session.use(sessionMiddleware(session)).handler(({ context }) => ({
      userId: context.userId,
      carried: context.sessionHeaders.get("cookie") ?? "",
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

it.effect(
  "a bearer-only caller is refused when only a cookie could name it, and read by its bearer",
  () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* answer(sessionOf, BEARER_PATH, { cookie: "session=s1" }), {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        text: '{"error":"invalid-token"}',
      });
      assert.deepEqual(yield* answer(sessionOf, BEARER_PATH, { authorization: "Bearer t" }), {
        status: HOSTED_HTTP_STATUS.OK,
        text: `{"userId":"${USER_ID}","carried":""}`,
      });
    }),
);

it.effect(
  "a session caller is answered with the headers that carry its session, and refused where the auth service names nobody or cannot answer",
  () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* answer(sessionOf, SESSION_PATH, { cookie: "session=s1" }), {
        status: HOSTED_HTTP_STATUS.OK,
        text: `{"userId":"${USER_ID}","carried":"session=s1"}`,
      });
      assert.deepEqual(yield* answer(sessionOf, SESSION_PATH, {}), {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        text: '{"error":"invalid-token"}',
      });
      const down: SessionUserIdResolver = () =>
        Effect.fail(new Cause.UnknownError("the auth service is down"));
      assert.deepEqual(yield* answer(down, SESSION_PATH, { cookie: "session=s1" }), {
        status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        text: '{"error":"unavailable"}',
      });
    }),
);
