/**
 * trace.ts -- a cloud launch's startup as spans in the launch's own Sentry trace, and its time to first token as a metric; nothing at all where the config hands no trace, as on a host.
 *
 * The service hands a launch in the cloud's sandbox its Sentry and the trace
 * its launch span (`web/agentLaunch`) stands in, as the config's `trace`.
 * The runner starts Sentry's Node SDK on it with no integrations, so it
 * captures no error, instruments no module, and sends only what this file
 * makes: a startup span continuing that trace, from the process's start to
 * the turn's first streamed token, and beneath it the config's read, the
 * harness's start (Claude Code's MCP relays and its CLI's first word,
 * Codex's app-server spawned and its thread opened), and the turn's first
 * model request and first token, each named by its harness and the launch's
 * path. The time from the runner taking the turn's message to that first
 * token is a distribution and an attribute of the first token's span. Every
 * post the runner makes carries the trace as well, so the service's spans
 * for them join it and follow its sampling. A span or a metric keeps only
 * the attributes set here and Sentry's own `sentry.*` bookkeeping, so
 * nothing leaves but ids, names, kinds and durations.
 *
 * Note that the spans are started inactive and parented by hand, because a
 * fiber does not carry the Node async context the SDK reads an active span
 * from.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as Sentry from "@sentry/node";
import { Effect, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  type CodexNotification,
  RUNNER_EVENT,
  type RunnerHarness,
  type RunnerMessage,
  type RunnerTrace,
} from "./protocol.js";

/** The spans of a launch's startup. */
export const RUNNER_SPAN = {
  STARTUP: "runner/startup",
  CONFIG: "runner/config",
  MCP_RELAY: "runner/mcpRelay",
  CLI: "runner/cli",
  HANDSHAKE: "runner/handshake",
  FIRST_REQUEST: "runner/firstRequest",
  FIRST_TOKEN: "runner/firstToken",
} as const;
export type RunnerSpan = (typeof RUNNER_SPAN)[keyof typeof RUNNER_SPAN];

/** The attributes this file sets, the only ones a span or a metric keeps beside Sentry's own. */
const ATTRIBUTE = {
  HARNESS: "harness",
  PATH: "path",
  TIME_TO_FIRST_TOKEN_MS: "time_to_first_token_ms",
} as const;

const KEPT_ATTRIBUTES: ReadonlySet<string> = new Set(Object.values(ATTRIBUTE));

/** What leads Sentry's own attributes: the trace's segment, the SDK, the environment and release. */
const SENTRY_ATTRIBUTE_PREFIX = "sentry.";

/** The time from the runner taking the turn's message to its first streamed token. */
const TIME_TO_FIRST_TOKEN = "agent.runner.time_to_first_token";

/**
 * How long the runner waits on Sentry to send what it queued, after the
 * first token and as the launch ends, so a Stop's end is held at most this.
 */
const FLUSH_MS = 1_000;

/** Claude Code's status as it begins a request to the model. */
const CLAUDE_REQUESTING = "requesting";

/** Codex's notification of a turn begun. */
const CODEX_TURN_STARTED = "turn/started";

/** Codex's notifications of streamed text: the agent's words and its reasoning's. */
const CODEX_DELTAS: ReadonlySet<string> = new Set([
  "item/agentMessage/delta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
]);

/** A launch's tracing, as the runner and either harness's launch use it. */
export interface LaunchTrace {
  /** Runs the launch with every post it makes carrying the launch's trace in place of a trace of its own. */
  readonly traced: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R | HttpClient.HttpClient>;
  /** Headers carrying the launch's trace, for a post made outside its client. */
  readonly headers: Readonly<Record<string, string>>;
  /** Runs a step of the harness's start under a span of its own, beneath the startup's. */
  readonly step: <A, E, R>(
    name: RunnerSpan,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  /** Claude Code's CLI started, its span ended by the first message it puts out. */
  readonly cliStarted: Effect.Effect<void>;
  /** The turn's message taken, from which its first token is timed; the launch's first alone counts. */
  readonly taken: Effect.Effect<void>;
  /** A message the launch posts, watched for the CLI's first word and the turn's first model request and first token. */
  readonly observe: (message: RunnerMessage) => Effect.Effect<void>;
}

/** The tracing of a launch handed no trace: it runs exactly as it would without this file. */
const UNTRACED: LaunchTrace = {
  traced: (effect) => effect,
  headers: {},
  step: (_name, effect) => effect,
  cliStarted: Effect.void,
  taken: Effect.void,
  observe: () => Effect.void,
};

/** Attributes as they leave: those this file set, and Sentry's own. */
function keptAttributes<Attributes extends Record<string, unknown>>(
  attributes: Attributes,
): Attributes {
  // SAFETY: a subset of the attributes' own entries, each kept as it was.
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => KEPT_ATTRIBUTES.has(key) || key.startsWith(SENTRY_ATTRIBUTE_PREFIX),
    ),
  ) as Attributes;
}

/**
 * What the SDK starts with: the service's project, environment and release;
 * no integrations, so nothing is instrumented and no uncaught error is
 * caught; no error event, no client report; and the launch trace's own
 * sampling, with none of the runner's own where the trace named none.
 * Note that the runtime's module hooks stay off, because nothing here needs
 * them and the launch's start is to run as it did.
 */
function sentryOptions(trace: RunnerTrace): Sentry.NodeOptions {
  return {
    dsn: trace.dsn,
    environment: trace.environment,
    ...(trace.release === undefined ? undefined : { release: trace.release }),
    defaultIntegrations: false,
    enableRuntimeChannelInjection: false,
    sendClientReports: false,
    tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(0),
    beforeSend: () => null,
    beforeSendSpan: (span) => ({ ...span, attributes: keptAttributes(span.attributes) }),
    beforeSendMetric: (metric) =>
      metric.attributes === undefined
        ? metric
        : { ...metric, attributes: keptAttributes(metric.attributes) },
  };
}

const RUNNER_EVENTS: ReadonlySet<string> = new Set(Object.values(RUNNER_EVENT));

/** Whether a message is the harness's own, rather than one of the runner's events. */
function isHarnessMessage(message: RunnerMessage): boolean {
  return "method" in message || !RUNNER_EVENTS.has(message.type);
}

/** Whether a message is the harness beginning a request to the model. */
function isModelRequest(message: RunnerMessage): boolean {
  if ("method" in message) return message.method === CODEX_TURN_STARTED;
  const sdk = message as SDKMessage;
  return sdk.type === "system" && sdk.subtype === "status" && sdk.status === CLAUDE_REQUESTING;
}

/** Whether a message is the first of the model's streamed words. */
function isStreamedToken(message: RunnerMessage): boolean {
  if ("method" in message) return CODEX_DELTAS.has((message as CodexNotification).method);
  const sdk = message as SDKMessage;
  return sdk.type === "stream_event" && sdk.event.type === "content_block_delta";
}

/** The turn whose first token is timed: when its message was taken, and the spans that wait on it. */
interface TimedTurn {
  readonly takenAt: number;
  readonly firstToken: Sentry.Span;
  readonly firstRequest: Sentry.Span;
}

/**
 * The startup's spans as a launch moves through them. Note that a span
 * ends once, and ending it again does nothing, so whatever is still open
 * as the launch ends is ended whole.
 */
interface Startup {
  readonly span: Sentry.Span;
  readonly attributes: Readonly<Record<string, string>>;
  cli: Sentry.Span | undefined;
  turn: TimedTurn | undefined;
  tokened: boolean;
}

/** A span of the startup's, beneath the startup's own or the parent given. */
function childSpan(
  startup: Startup,
  name: RunnerSpan,
  parentSpan = startup.span,
  startTime?: number,
) {
  return Sentry.startInactiveSpan({
    name,
    parentSpan,
    attributes: startup.attributes,
    ...(startTime === undefined ? undefined : { startTime }),
  });
}

/** Ends every span of the startup's still open, its own last. */
function endStartup(startup: Startup): void {
  startup.cli?.end();
  startup.turn?.firstRequest.end();
  startup.turn?.firstToken.end();
  startup.span.end();
}

/**
 * Watches one message for the CLI's first word and the turn's first model
 * request and first token; answers whether it was the first token, which
 * recorded the turn's time to it and ended the startup.
 */
function observed(startup: Startup, message: RunnerMessage): boolean {
  if (startup.cli !== undefined && isHarnessMessage(message)) {
    startup.cli.end();
    startup.cli = undefined;
  }
  const turn = startup.turn;
  if (turn === undefined || startup.tokened) return false;
  if (isModelRequest(message)) turn.firstRequest.end();
  if (!isStreamedToken(message)) return false;
  startup.tokened = true;
  const elapsed = Math.round(performance.now() - turn.takenAt);
  turn.firstToken.setAttribute(ATTRIBUTE.TIME_TO_FIRST_TOKEN_MS, elapsed);
  Sentry.withActiveSpan(turn.firstToken, () =>
    Sentry.metrics.distribution(TIME_TO_FIRST_TOKEN, elapsed, {
      unit: "millisecond",
      attributes: startup.attributes,
    }),
  );
  endStartup(startup);
  return true;
}

/** The SDK started on the trace handed, and the startup's span begun at the process's start, its config's read beneath it. */
function begunStartup(trace: RunnerTrace, harness: RunnerHarness): Startup {
  Sentry.init(sentryOptions(trace));
  const attributes = {
    [ATTRIBUTE.HARNESS]: harness,
    ...(trace.path === undefined ? undefined : { [ATTRIBUTE.PATH]: trace.path }),
  };
  // Note that Node's time origin is the instant the process started.
  const processStart = performance.timeOrigin;
  const span = Sentry.continueTrace(
    { sentryTrace: trace.sentryTrace, baggage: trace.baggage },
    () =>
      Sentry.withActiveSpan(null, () =>
        Sentry.startInactiveSpan({
          name: RUNNER_SPAN.STARTUP,
          startTime: processStart,
          attributes,
        }),
      ),
  );
  const startup: Startup = { span, attributes, cli: undefined, turn: undefined, tokened: false };
  childSpan(startup, RUNNER_SPAN.CONFIG, span, processStart).end();
  return startup;
}

/** What Sentry queued, sent within its bound. */
const flushed = Effect.asVoid(Effect.promise(() => Sentry.flush(FLUSH_MS)));

/** A launch's tracing on the trace it was handed. */
function tracedLaunch(startup: Startup): LaunchTrace {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    Sentry.getTraceData({ span: startup.span, propagateTraceparent: true }),
  )) {
    if (value !== undefined) headers[name] = value;
  }
  return {
    traced: (effect) =>
      effect.pipe(
        Effect.updateService(HttpClient.HttpClient, (client) =>
          HttpClient.mapRequest(client, HttpClientRequest.setHeaders(headers)),
        ),
        // Note that the client's own spans put no trace of theirs on a post, which carries the launch's.
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      ),
    headers,
    step: (name, effect) =>
      Effect.suspend(() => {
        const span = childSpan(startup, name);
        return Effect.ensuring(
          effect,
          Effect.sync(() => span.end()),
        );
      }),
    cliStarted: Effect.sync(() => {
      startup.cli = childSpan(startup, RUNNER_SPAN.CLI);
    }),
    taken: Effect.sync(() => {
      if (startup.turn !== undefined) return;
      const firstToken = childSpan(startup, RUNNER_SPAN.FIRST_TOKEN);
      const firstRequest = childSpan(startup, RUNNER_SPAN.FIRST_REQUEST, firstToken);
      startup.turn = { takenAt: performance.now(), firstToken, firstRequest };
    }),
    // The first token's spans and metric are sent at once rather than as the launch ends, which may be an hour off.
    observe: (message) =>
      Effect.suspend(() =>
        observed(startup, message) ? Effect.asVoid(Effect.forkDetach(flushed)) : Effect.void,
      ),
  };
}

/**
 * The tracing of a launch on its config: on the trace it was handed, its
 * open spans ended and what Sentry queued sent as the launch's scope
 * closes; or none, where it was handed no trace.
 */
export const launchTrace = (
  trace: RunnerTrace | undefined,
  harness: RunnerHarness,
): Effect.Effect<LaunchTrace, never, Scope.Scope> =>
  trace === undefined
    ? Effect.succeed(UNTRACED)
    : Effect.map(
        Effect.acquireRelease(
          Effect.sync(() => begunStartup(trace, harness)),
          (startup) =>
            Effect.andThen(
              Effect.sync(() => endStartup(startup)),
              flushed,
            ),
        ),
        tracedLaunch,
      );
