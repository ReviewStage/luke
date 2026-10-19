import type { DatabaseServices } from "@luke/database/core/query";
import { Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { readAccountPerson } from "../accounts/account-person.js";
import { resolveHostedUserId } from "../auth/bearer.js";
import { HostedEnvironment } from "../environment.js";
import { effectPassthrough, hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { type EventsOptions, handleEvents } from "./events.js";

/**
 * The events group: the desktop's analytics ingest, carried to an `HttpApp`
 * by the `HttpRouter`, with the hosted vocabulary's own `not-found` on any
 * path it does not declare.
 */

const EVENTS_PATH = "/api/events";

/** Vercel's own name for the deployment: `production`, `preview`, or `development`. */
const DEPLOYMENT_VARIABLE = "VERCEL_ENV";

/**
 * Records what the signed-in desktop counted about its own use. The logic
 * lives in `packages/service/src/events/events.ts`; this hands it the deployment's real
 * seams — the project token the desktop never holds, and the same
 * in-process token resolution every other hosted endpoint trusts, whose
 * userinfo answer `packages/service/src/auth/bearer.ts` parses at the boundary.
 */
const eventsEffect = /* @__PURE__ */ Effect.fn("web/eventsEffect")(function* (
  request: Request,
): Effect.fn.Return<Response, never, DatabaseServices | HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  const options: EventsOptions = {
    request,
    projectApiKey:
      environment.posthogProjectApiKey === undefined
        ? undefined
        : Redacted.value(environment.posthogProjectApiKey),
    resolveUserId: resolveHostedUserId,
    // Vercel's own variable, read where Sentry reads it for the same name.
    deployment: process.env[DEPLOYMENT_VARIABLE],
    // Read from the service's own user row rather than from the request, so
    // the desktop still sends nothing that names anybody.
    readPerson: readAccountPerson,
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
export function eventsApp(): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    // `ANY_METHOD`, not `POST`: the handler decides its own method refusal, so
    // a request to the right path on the wrong method still answers 405 rather
    // than falling through to the group's own 404.
    HttpRouter.add(ANY_METHOD, EVENTS_PATH, effectPassthrough(eventsEffect)),
    hostedNotFoundRoute,
  );
}
