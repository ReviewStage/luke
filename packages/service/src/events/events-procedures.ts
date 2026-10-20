/**
 * events-procedures.ts -- the desktop's product analytics batch, recorded for the signed-in account.
 *
 * `POST /api/events` takes an allowlisted batch and forwards it under the
 * caller's account (`events.ts`). The checks run in the order the old
 * route ran them, as far as a procedure can: an unconfigured deployment is
 * unavailable before any caller is resolved, so it does no work at all;
 * then the caller; then the body's stated size; then the batch itself.
 */

import { middlewareGen } from "@orpc/experimental-effect";
import { Effect, Redacted } from "effect";
import { readAccountPerson } from "../accounts/account-person.js";
import { text as trimmedText, type UnparsedWireValue } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, type HostedContext, hosted } from "../orpc/base.js";
import { type EventsOptions, recordEvents } from "./events.js";

/** Vercel's own name for the deployment: `production`, `preview`, or `development`. */
const DEPLOYMENT_VARIABLE = "VERCEL_ENV";

export interface EventsProcedureSeams {
  /** The account behind a request: its bearer, or with none, the browser's session cookie. */
  resolveUserId: UserIdResolver;
}

/**
 * The deployment's analytics project token and ingestion host. A missing
 * or whitespace token is the kill switch, not a key: an unconfigured
 * deployment is simply not measured, and nothing else depends on this
 * endpoint answering.
 */
const recordingConfigured = middlewareGen<HostedContext, { recording: EventsOptions }>(function* ({
  next,
}) {
  const environment = yield* HostedEnvironment;
  const projectApiKey = trimmedText(
    environment.posthogProjectApiKey === undefined
      ? undefined
      : Redacted.value(environment.posthogProjectApiKey),
  );
  if (!projectApiKey) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const recording: EventsOptions = {
    projectApiKey,
    // Vercel's own variable, read where Sentry reads it for the same name.
    deployment: process.env[DEPLOYMENT_VARIABLE],
    // Read from the service's own user row rather than from the request, so
    // the desktop still sends nothing that names anybody.
    readPerson: readAccountPerson,
  };
  if (environment.posthogIngestHost) recording.host = environment.posthogIngestHost;
  return yield* next({ context: { recording } });
});

/** The events resource: one batch, recorded for a signed-in caller. */
export function eventsProcedures(seams: EventsProcedureSeams) {
  return {
    record: hosted.events
      .use(recordingConfigured)
      .use(accountMiddleware(seams.resolveUserId))
      .record.effect(function* ({ context, input }) {
        // SAFETY: the handler parsed the body from JSON text; the batch reader is the parser.
        const payload = input as UnparsedWireValue;
        return yield* recordEvents(context.userId, payload, context.recording);
      }),
  };
}
