import {
  scrubbedAttributes,
  scrubbedQueryParams,
  scrubbedUrl,
} from "@repo/features/sentry-addresses";
import * as Sentry from "@sentry/effect";
import {
  addBreadcrumb,
  type ErrorEvent,
  type EventHint,
  SentryEffectExternalSpanLayer,
} from "@sentry/effect/server";
import { Effect, ErrorReporter, Exit, Layer, Logger, Predicate, References, Tracer } from "effect";

export const SENTRY_ENVIRONMENT = {
  DSN: "SENTRY_DSN",
  DEPLOYMENT: "VERCEL_ENV",
} as const;

const UNNAMED_DEPLOYMENT = "development";

const SEVERITY_LEVEL = { Fatal: "fatal", Warn: "warning" } as const;

const PROMISE_EDGE_MECHANISM = { type: "vespin.promise_edge", handled: false } as const;

export interface CronMonitor {
  readonly slug: string;
  readonly crontab: string;
  readonly maxRuntimeMinutes: number;
  readonly checkInMarginMinutes: number;
  readonly failuresBeforeIssue: number;
}

type MonitorConfig = NonNullable<Parameters<typeof Sentry.captureCheckIn>[1]>;

const TRACES_SAMPLE_RATE = 0.1;

export type SentryOptions = Sentry.NodeOptions;

const MODEL_CONTENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "agent.approval.request",
  "agent.approval.response",
  "agent.channel.delivery.input",
  "agent.session.title",
  "ai.documents",
  "ai.embedding",
  "ai.embeddings",
  "ai.input_messages",
  "ai.prompt",
  "ai.prompt.messages",
  "ai.prompt.toolChoice",
  "ai.prompt.tools",
  "ai.ranking",
  "ai.raw_prompting",
  "ai.response.files",
  "ai.response.object",
  "ai.response.reasoning",
  "ai.response.text",
  "ai.response.toolCalls",
  "ai.response.tool_calls",
  "ai.response.tool_results",
  "ai.search_results",
  "ai.texts",
  "ai.toolCall.args",
  "ai.toolCall.result",
  "ai.tool_calls",
  "ai.value",
  "ai.values",
  "gen_ai.embeddings.input",
  "gen_ai.input.messages",
  "gen_ai.memory.query.text",
  "gen_ai.memory.records",
  "gen_ai.output.messages",
  "gen_ai.prompt",
  "gen_ai.request.available_tools",
  "gen_ai.request.messages",
  "gen_ai.response.object",
  "gen_ai.response.text",
  "gen_ai.response.tool_calls",
  "gen_ai.system.message",
  "gen_ai.system_instructions",
  "gen_ai.text_completion",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "gen_ai.tool.definitions",
  "gen_ai.tool.input",
  "gen_ai.tool.message",
  "gen_ai.tool.output",
]);

const DB_QUERY_TEXT = "db.query.text";

function namedForStatement<Span extends { name: string; attributes?: object }>(span: Span): Span {
  const text: unknown = span.attributes && Reflect.get(span.attributes, DB_QUERY_TEXT);
  return typeof text === "string" && text.length > 0 ? { ...span, name: text } : span;
}

function scrubbedSpanAttributes<Attributes extends object>(attributes: Attributes): Attributes {
  const kept = Object.entries(attributes).filter(([name]) => !MODEL_CONTENT_ATTRIBUTES.has(name));
  return scrubbedAttributes(Object.fromEntries(kept) as Attributes);
}

const AI_TOOL_ERROR = {
  MECHANISM: "auto.vercelai.channel",
  TOOL_TAG: "vercel.ai.tool.name",
  CALL_TAG: "vercel.ai.tool.callId",
} as const;

function isAnsweredToolError(event: ErrorEvent): boolean {
  return (
    event.tags?.[AI_TOOL_ERROR.TOOL_TAG] !== undefined &&
    (event.exception?.values ?? []).some(
      (value) => value.mechanism?.type === AI_TOOL_ERROR.MECHANISM,
    )
  );
}

const REFUSAL_CAUSE_DEPTH = 5;

function isRefusal(failure: Error, depth = 0): boolean {
  const { cause } = failure;
  return (
    Object.getPrototypeOf(failure) === Error.prototype &&
    Object.keys(failure).every((key) => key === "cause") &&
    depth < REFUSAL_CAUSE_DEPTH &&
    (cause === undefined || (cause instanceof Error && isRefusal(cause, depth + 1)))
  );
}

function dropAnsweredToolRefusals(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  const failure = hint.originalException;
  if (!isAnsweredToolError(event) || !(failure instanceof Error) || !isRefusal(failure))
    return event;
  const exception = event.exception?.values?.at(-1);
  addBreadcrumb({
    category: "ai.tool",
    level: "warning",
    message: `${String(event.tags?.[AI_TOOL_ERROR.TOOL_TAG])} failed: ${exception?.type ?? "Error"}: ${exception?.value ?? ""}`,
    data: {
      tool: event.tags?.[AI_TOOL_ERROR.TOOL_TAG],
      toolCallId: event.tags?.[AI_TOOL_ERROR.CALL_TAG],
    },
  });
  return null;
}

function scrubbedEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const { request, contexts, breadcrumbs } = event;
  const trace = contexts?.trace;
  return {
    ...event,
    ...(request && {
      request: {
        ...request,
        ...(request.url !== undefined && { url: scrubbedUrl(request.url) }),
        ...(request.query_string !== undefined && {
          query_string: scrubbedQueryParams(request.query_string),
        }),
      },
    }),
    ...(trace?.data && {
      contexts: { ...contexts, trace: { ...trace, data: scrubbedSpanAttributes(trace.data) } },
    }),
    ...(breadcrumbs && {
      breadcrumbs: breadcrumbs.map((crumb) =>
        crumb.data ? { ...crumb, data: scrubbedAttributes(crumb.data) } : crumb,
      ),
    }),
  };
}

export function sentryOptions(): SentryOptions {
  return {
    dsn: process.env[SENTRY_ENVIRONMENT.DSN],
    environment: process.env[SENTRY_ENVIRONMENT.DEPLOYMENT] ?? UNNAMED_DEPLOYMENT,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    dataCollection: { genAI: { inputs: false, outputs: false }, httpBodies: [] },
    beforeSend: (event, hint) => {
      const kept = dropAnsweredToolRefusals(event, hint);
      return kept && scrubbedEvent(kept);
    },
    beforeSendSpan: Sentry.withStreamedSpan((span) =>
      namedForStatement({ ...span, attributes: scrubbedSpanAttributes(span.attributes) }),
    ),
    beforeSendLog: (log) =>
      log.attributes ? { ...log, attributes: scrubbedAttributes(log.attributes) } : log,
  };
}

const sentryTelemetry = Layer.mergeAll(
  Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer),
  SentryEffectExternalSpanLayer,
  Sentry.SentryEffectMetricsLayer,
);

const ACCOUNT_KEY = "userId";

const SENTRY_USER_ID = "user.id";

const LOG_ORIGIN = { "sentry.origin": "auto.log.effect" } as const;

const SENTRY_LOG_METHOD = {
  Fatal: Sentry.logger.fatal,
  Error: Sentry.logger.error,
  Warn: Sentry.logger.warn,
  Info: Sentry.logger.info,
  Debug: Sentry.logger.debug,
  Trace: Sentry.logger.trace,
} as const;

function foldedLogMessage(message: unknown): string {
  if (Predicate.isString(message)) return message;
  if (Array.isArray(message) && message.length === 1) {
    const [only] = message;
    return Predicate.isString(only) ? only : JSON.stringify(only);
  }
  return JSON.stringify(message);
}

export const sentryLogger: Logger.Logger<unknown, void> = Logger.make(
  ({ fiber, logLevel, message }) => {
    if (logLevel === "All" || logLevel === "None") return;
    const { [ACCOUNT_KEY]: account, ...annotations } = fiber.getRef(
      References.CurrentLogAnnotations,
    );
    SENTRY_LOG_METHOD[logLevel](foldedLogMessage(message), {
      ...annotations,
      ...(Predicate.isString(account) ? { [SENTRY_USER_ID]: account } : undefined),
      ...LOG_ORIGIN,
    });
  },
);

const REPORT_TAG_ATTRIBUTES: ReadonlySet<string> = new Set([
  "agentId",
  "conversationId",
  "turnId",
  "taskId",
  "sessionId",
  "sandboxSessionId",
  "failure",
  "reason",
]);

const TAG_VALUE_MAX_LENGTH = 200;

function reportContext(
  { [ACCOUNT_KEY]: reported, ...attributes }: Readonly<Record<string, unknown>>,
  annotations: Readonly<Record<string, unknown>>,
): {
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  user?: { id: string };
} {
  const tags: Record<string, string> = {};
  const extra: Record<string, unknown> = {};
  const account = Predicate.isString(reported) ? reported : annotations[ACCOUNT_KEY];
  for (const [name, value] of Object.entries(attributes)) {
    const text =
      Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)
        ? String(value)
        : undefined;
    if (!REPORT_TAG_ATTRIBUTES.has(name) || text === undefined) extra[name] = value;
    else {
      tags[name] = text.slice(0, TAG_VALUE_MAX_LENGTH);
      if (text.length > TAG_VALUE_MAX_LENGTH) extra[name] = value;
    }
  }
  return { tags, extra, ...(Predicate.isString(account) ? { user: { id: account } } : undefined) };
}

const sentryErrorReporter = ErrorReporter.make(({ error, severity, attributes, fiber }) => {
  Sentry.captureException(error, {
    mechanism: { type: "auto.function.effect.error_reporter", handled: false },
    captureContext: {
      level: severity === "Fatal" || severity === "Warn" ? SEVERITY_LEVEL[severity] : "error",
      ...reportContext(attributes, fiber.getRef(References.CurrentLogAnnotations)),
    },
  });
});

const sentryReporting = ErrorReporter.layer([sentryErrorReporter], { mergeWithExisting: true });

export function sentryLayer(options: SentryOptions = sentryOptions()): Layer.Layer<never> {
  const started = Layer.effectDiscard(
    Effect.sync(() =>
      Sentry.init({
        ...options,
        integrations: [
          Sentry.onUncaughtExceptionIntegration(),
          Sentry.onUnhandledRejectionIntegration(),
        ],
      }),
    ),
  );
  return Layer.mergeAll(started, sentryReporting, sentryTelemetry);
}

const REQUEST_FLUSH_MS = 2_000;

type WebFetch = (request: Request) => Promise<Response>;

export function sentryReportedFetch(
  fetch: WebFetch,
  keepAwake: (sending: Promise<boolean>) => void,
): WebFetch {
  return async (request) => {
    try {
      return await fetch(request);
    } catch (failure) {
      Sentry.captureException(failure, {
        mechanism: { type: "auto.function.vercel", handled: false },
      });
      throw failure;
    } finally {
      keepAwake(Sentry.flush(REQUEST_FLUSH_MS));
    }
  };
}

export const sentryReportingLayer: Layer.Layer<never> = Layer.merge(
  sentryReporting,
  sentryTelemetry,
);

export function standReported<E, R>(
  run: (service: Effect.Effect<never, E, R>) => Promise<never>,
  service: Effect.Effect<never, E, R>,
): Promise<void> {
  let ran = false;
  const reported = Effect.suspend(() => {
    ran = true;
    return Effect.withErrorReporting(service);
  });
  return run(reported).catch((error) => {
    if (!ran) Sentry.captureException(error, { mechanism: PROMISE_EDGE_MECHANISM });
  });
}

const CHECK_IN_FLUSH_MS = 2_000;

const checkInDelivered = Effect.asVoid(Effect.promise(() => Sentry.flush(CHECK_IN_FLUSH_MS)));

function monitorConfig(monitor: CronMonitor): MonitorConfig {
  return {
    schedule: { type: "crontab", value: monitor.crontab },
    checkinMargin: monitor.checkInMarginMinutes,
    maxRuntime: monitor.maxRuntimeMinutes,
    failureIssueThreshold: monitor.failuresBeforeIssue,
    timezone: "Etc/UTC",
  };
}

export function sentryCronCheckIns(monitor: CronMonitor) {
  const config = monitorConfig(monitor);
  return {
    run: <A, E, R>(job: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.flatMap(
        Effect.sync(() =>
          Sentry.captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, config),
        ),
        (checkInId) =>
          Effect.onExit(job, (exit) =>
            Effect.sync(() => {
              Sentry.captureCheckIn(
                {
                  checkInId,
                  monitorSlug: monitor.slug,
                  status: Exit.isSuccess(exit) ? "ok" : "error",
                },
                config,
              );
            }).pipe(Effect.andThen(checkInDelivered)),
          ),
      ),
  };
}
