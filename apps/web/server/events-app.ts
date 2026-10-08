import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { auth } from "./auth.js";
import { user } from "./db/auth-schema.js";
import { db } from "./db/query.js";
import { hostedUserId } from "./hosted/bearer.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { type EventsOptions, handleEvents } from "./hosted/events.js";
import { effectPassthrough, hostedNotFoundRoute } from "./hosted/http-effect.js";
import type { PosthogPerson } from "./hosted/posthog.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * The events group: the desktop's analytics ingest, carried to an `HttpApp`
 * by the `HttpRouter`, with the hosted vocabulary's own `not-found` on any
 * path it does not declare.
 */

/** How a statement below fails: the driver's own refusal, or a row this build cannot decode. */
type EventsAppFailure = SqlError | Schema.SchemaError;

const PersonRowSchema = Schema.Struct({ name: Schema.String, email: Schema.String });

const findPerson = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PersonRowSchema,
  execute: (userId) =>
    db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
});

/** Reads the signed-in user's own name and email, for the events endpoint's PostHog person fields. */
export function readPerson(
  userId: string,
): Effect.Effect<PosthogPerson | undefined, EventsAppFailure, SqlClient.SqlClient> {
  return Effect.map(findPerson(userId), Option.getOrUndefined);
}

const EVENTS_PATH = "/api/events";

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `server/hosted/events.ts`; this hands it the deployment's real
 * seams — the project token the desktop never holds, and the same
 * in-process token resolution every other hosted endpoint trusts. The
 * userinfo call is better-auth's own foreign promise, so it is wrapped here,
 * at the seam's implementation, rather than inside the handler.
 */
const eventsEffect = /* @__PURE__ */ Effect.fn("web/eventsEffect")(function* (
  request: Request,
): Effect.fn.Return<Response, never, SqlClient.SqlClient | HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  const options: EventsOptions = {
    request,
    projectApiKey:
      environment.posthogProjectApiKey === undefined
        ? undefined
        : Redacted.value(environment.posthogProjectApiKey),
    resolveUserId: (incoming) =>
      hostedUserId(incoming, (input) => Effect.tryPromise(() => auth.api.oauth2UserInfo(input))),
    // Read from the service's own user row rather than from the request, so
    // the desktop still sends nothing that names anybody.
    readPerson,
  };
  if (environment.posthogIngestHost) options.host = environment.posthogIngestHost;
  return yield* handleEvents(options);
});

/**
 * The group: the ingest carried to an `HttpApp`, and the hosted vocabulary's
 * own refusal for a path it does not declare — unreachable in production,
 * since `vercel.json` sends the function only its own path, but the same
 * shape `auth-app.ts` answers with.
 */
export function eventsApp(): WebRoutes<SqlClient.SqlClient | HostedEnvironment> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `POST`: the handler decides its own method refusal, so
    // a request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, EVENTS_PATH, effectPassthrough(eventsEffect)),
    hostedNotFoundRoute,
  );
}
