/**
 * error-reports.ts -- the deployment's errors as Sentry issues: every log line at Error or above, every route that ended unanswered, and the sweep's check-ins.
 *
 * The deployment's logs already go to Vercel as JSON (`runtime.ts`); this is
 * the second logger beside that one, the one that pages. It speaks Sentry's
 * own client, without the Node SDK's global hub and OpenTelemetry, so nothing
 * is instrumented behind the code's back: what reaches Sentry is what an
 * effect logged at Error or Fatal, the cause it was handed, and a cron's
 * check-in, nothing else. A deployment without `SENTRY_DSN` reports nothing.
 *
 * Note that a report carries no request, no account, and no breadcrumb: the
 * client is built with no integrations, and every text an event carries is
 * passed through `redactCredentials` before it leaves, the same words the
 * Vercel log line beside it already holds.
 */

import {
  createStackParser,
  createTransport,
  type ErrorEvent,
  type EventHint,
  linkedErrorsIntegration,
  type MonitorConfig,
  nodeStackLineParser,
  ServerRuntimeClient,
  type ServerRuntimeClientOptions,
  type SeverityLevel,
  vercelWaitUntil,
} from "@sentry/core";
import {
  Cause,
  Config,
  Context,
  Effect,
  Formatter,
  Layer,
  Logger,
  LogLevel,
  Option,
  Predicate,
} from "effect";
import { text } from "../core.js";
import { redactCredentials } from "./redact-credentials.js";

export const ERROR_REPORTS_ENVIRONMENT = {
  /** The `luke-web` Sentry project's DSN; absent means the deployment reports nothing. */
  DSN: "SENTRY_DSN",
  /** Vercel's own name for the deployment: `production`, `preview`, or `development`. */
  DEPLOYMENT: "VERCEL_ENV",
  /** The commit the deployment was built from, which names its release. */
  COMMIT: "VERCEL_GIT_COMMIT_SHA",
} as const;

/** How a cron's run ended, as Sentry's monitor hears it. */
export const CHECK_IN_STATUS = { OK: "ok", ERROR: "error" } as const;

export type CheckInStatus = (typeof CHECK_IN_STATUS)[keyof typeof CHECK_IN_STATUS];

/** A scheduled job Sentry watches: missed, late, or failed runs open an issue on its monitor. */
export interface CronMonitor {
  readonly slug: string;
  /** The crontab Vercel calls it on, which Sentry expects a check-in against. */
  readonly crontab: string;
  /** The longest a run may take before Sentry marks it timed out, in minutes. */
  readonly maxRuntimeMinutes: number;
}

/** How long a report may hold an invocation open to leave, and how long a closing runtime waits for the rest. */
const FLUSH_MS = 2_000;

/** The deployment name a report carries when Vercel names none, as a local `vercel dev` or a test. */
const UNNAMED_DEPLOYMENT = "development";

/** Late a check-in may be before Sentry calls the run missed, in minutes: the sweep's own minute and one more. */
const CHECK_IN_MARGIN_MINUTES = 2;

/** Failed or missed runs in a row before Sentry opens the monitor's issue, so one slow minute pages nobody. */
const FAILURES_BEFORE_ISSUE = 3;

export class ErrorReports extends Context.Service<
  ErrorReports,
  {
    /** The logger that files every line at Error or above; one that does nothing where reporting is off. */
    readonly logger: Logger.Logger<unknown, void>;
    /** A cron's run as it ended, with how long it took. */
    readonly checkIn: (
      monitor: CronMonitor,
      status: CheckInStatus,
      durationSeconds: number,
    ) => Effect.Effect<void>;
  }
>()("ErrorReports") {}

/** What a test hands the layer in place of the network: Sentry's own transport factory. */
export type ErrorReportsTransport = ServerRuntimeClientOptions["transport"];

const NO_ERROR_REPORTS = ErrorReports.of({
  logger: Logger.make(() => undefined),
  checkIn: () => Effect.void,
});

/** Sentry's envelope, posted to the DSN's ingest URL with the platform's own `fetch`. */
const fetchTransport: ErrorReportsTransport = (options) =>
  createTransport(options, async (request) => {
    const body = Predicate.isString(request.body) ? request.body : new Uint8Array(request.body);
    const response = await fetch(options.url, { method: "POST", body });
    return {
      statusCode: response.status,
      headers: {
        "x-sentry-rate-limits": response.headers.get("x-sentry-rate-limits"),
        "retry-after": response.headers.get("retry-after"),
      },
    };
  });

/**
 * Sentry's `beforeSend`: the event with its message, every exception's
 * message, and the log line it came from redacted. The stack frames are code
 * locations and are kept.
 */
function redactedEvent(event: ErrorEvent): ErrorEvent {
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = redactCredentials(exception.value);
  }
  if (event.message !== undefined) event.message = redactCredentials(event.message);
  const log = event.contexts?.log;
  if (log !== undefined && Predicate.isString(log.message)) {
    log.message = redactCredentials(log.message);
  }
  return event;
}

/** The client every report of this instance leaves through. */
function openClient(
  dsn: string,
  environment: string,
  release: string | undefined,
  transport: ErrorReportsTransport,
): ServerRuntimeClient {
  const client = new ServerRuntimeClient({
    dsn,
    environment,
    release,
    transport,
    stackParser: createStackParser(nodeStackLineParser()),
    // An error's own `cause` chain is the one thing worth an integration:
    // Effect's tagged errors wrap the provider failure that started them.
    integrations: [linkedErrorsIntegration()],
    sendDefaultPii: false,
    beforeSend: redactedEvent,
    platform: "node",
    runtime: { name: "node", version: process.version },
  });
  client.init();
  return client;
}

/**
 * Lets the invocation outlive its response until the report has left: a
 * Vercel function is frozen once it answers, and a report still in the
 * transport's queue would go with it. Off Vercel it is the transport's own
 * queue that sends it.
 */
function flushBeforeFreeze(client: ServerRuntimeClient): void {
  vercelWaitUntil(Promise.resolve(client.flush(FLUSH_MS)));
}

/** One log line as an issue: the cause's error where it was handed one, the line's own words otherwise. */
function reportLine(client: ServerRuntimeClient, line: Logger.Options<unknown>): void {
  // `Effect.log*` hands its arguments as an array, the cause already taken out of it.
  const parts = Array.isArray(line.message) ? line.message : [line.message];
  const words = parts
    .map((part) => (Predicate.isString(part) ? part : Formatter.format(part)))
    .join(" ");
  const level: SeverityLevel = line.logLevel === "Fatal" ? "fatal" : "error";
  const hint: EventHint = { captureContext: { level, contexts: { log: { message: words } } } };
  if (line.cause.reasons.length === 0) client.captureMessage(words, level, hint);
  else client.captureException(Cause.squash(line.cause), hint);
  flushBeforeFreeze(client);
}

/** The monitor Sentry upserts from a check-in, so no monitor is made by hand. */
function monitorConfig(monitor: CronMonitor): MonitorConfig {
  return {
    schedule: { type: "crontab", value: monitor.crontab },
    checkinMargin: CHECK_IN_MARGIN_MINUTES,
    maxRuntime: monitor.maxRuntimeMinutes,
    failureIssueThreshold: FAILURES_BEFORE_ISSUE,
    timezone: "Etc/UTC",
  };
}

function reportingTo(client: ServerRuntimeClient): typeof ErrorReports.Service {
  return ErrorReports.of({
    logger: Logger.make((line) => {
      if (LogLevel.isGreaterThanOrEqualTo(line.logLevel, "Error")) reportLine(client, line);
    }),
    checkIn: (monitor, status, durationSeconds) =>
      Effect.sync(() => {
        client.captureCheckIn(
          { monitorSlug: monitor.slug, status, duration: durationSeconds },
          monitorConfig(monitor),
        );
        flushBeforeFreeze(client);
      }),
  });
}

/**
 * The deployment's reports, read from its environment as the services are
 * built. The client is closed with the runtime, which waits for what is
 * still queued, bounded so a close never holds a process open.
 */
export function errorReportsLayer(
  transport: ErrorReportsTransport = fetchTransport,
): Layer.Layer<ErrorReports, Config.ConfigError> {
  return Layer.effect(
    ErrorReports,
    Effect.gen(function* () {
      const environment = yield* Config.all({
        dsn: Config.option(Config.String(ERROR_REPORTS_ENVIRONMENT.DSN)),
        deployment: Config.option(Config.String(ERROR_REPORTS_ENVIRONMENT.DEPLOYMENT)),
        commit: Config.option(Config.String(ERROR_REPORTS_ENVIRONMENT.COMMIT)),
      });
      const dsn = text(Option.getOrUndefined(environment.dsn));
      if (dsn === undefined) return NO_ERROR_REPORTS;
      const client = yield* Effect.acquireRelease(
        Effect.sync(() =>
          openClient(
            dsn,
            text(Option.getOrUndefined(environment.deployment)) ?? UNNAMED_DEPLOYMENT,
            text(Option.getOrUndefined(environment.commit)),
            transport,
          ),
        ),
        (opened) => Effect.promise(() => Promise.resolve(opened.close(FLUSH_MS))),
      );
      return reportingTo(client);
    }),
  );
}

/** The reporting logger, for the runtime's logger set beside the JSON one. */
export const errorReportsLogger = Effect.map(
  Effect.service(ErrorReports),
  (reports) => reports.logger,
);

/**
 * A route's handler with an unanswered end logged at Error, which the logger
 * above files: a group recovers every refusal into its own answer
 * (`route.ts`), so a failure or a defect that reaches the router is a bug,
 * and the router would otherwise turn it into a bare 500 and say nothing. An
 * interruption is a client that hung up, and is not one.
 */
export function logRouteFailure<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.tapCause(effect, (cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.logError("a route ended without an answer", cause),
  );
}

/**
 * An edge's effect with a defect logged at Error before its promise rejects:
 * a typed failure is the caller's to answer, but a defect is a bug no caller
 * of the promise will log.
 */
export function logDefect<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.tapCause(effect, (cause) =>
    Cause.hasDies(cause) ? Effect.logError("an edge's effect died", cause) : Effect.void,
  );
}
