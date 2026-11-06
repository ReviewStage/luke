import { middlewareGen } from "@orpc/experimental-effect";
import { Effect, Redacted } from "effect";
import { readAccountPerson } from "../accounts/account-person.js";
import { text as trimmedText, type UnparsedWireValue } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_REFUSAL, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, type HostedContext, hosted } from "../orpc/base.js";
import { DEPLOYMENT_VARIABLE, type EventsOptions, recordEvents } from "./events.js";

export interface EventsProcedureSeams {
  resolveUserId: UserIdResolver;
}

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
    deployment: process.env[DEPLOYMENT_VARIABLE],
    readPerson: readAccountPerson,
  };
  if (environment.posthogIngestHost) recording.host = environment.posthogIngestHost;
  return yield* next({ context: { recording } });
});

export function eventsProcedures(seams: EventsProcedureSeams) {
  return {
    record: hosted.events
      .use(recordingConfigured)
      .use(accountMiddleware(seams.resolveUserId))
      .record.effect(function* ({ context, input }) {
        const payload = input as UnparsedWireValue;
        return yield* recordEvents(context.userId, payload, context.recording);
      }),
  };
}
