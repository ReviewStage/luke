/**
 * sentry-tracing.ts -- how much every desktop process traces and profiles, which requests it never traces, and the trace a send carries to the service.
 *
 * Main, the preload, and each window's renderer start their own Sentry SDK,
 * and a renderer's SDK hands every envelope and scope change to main over
 * Electron's `sentry-ipc://` protocol, as a `fetch`. Browser tracing records
 * each `fetch` as a span, so a renderer left to trace everything traced its
 * own reporting: every report it sent was a span, and every span another
 * report. Those requests are the app talking to itself and are never traced.
 * Note that this sits here rather than in `@repo/host`, because the renderer
 * reads it and may import only three of host's doors.
 *
 * A send the developer presses, an agent started or a message sent, is a
 * span of its own in the client's SDK, the desktop window's or the web tab's,
 * named from `SENTRY_SEND_SPAN`, whose trace is carried to the host that
 * sends it (`SendTrace`) and on to the service as Sentry's own headers, as
 * Sentry's guide to custom trace propagation has it. The host's call reads
 * it off `SentSendTrace`, which the act port sets for the call it came with.
 */

import type { TracesSamplerSamplingContext } from "@sentry/core";
import { Context, Predicate } from "effect";

/** The share of traces kept: enough to read start-up and page-load times by, not every one. */
export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

/**
 * The share of launches whose windows are profiled, through the whole
 * launch: enough to find what runs hot in the field, not every Mac's cost.
 */
export const SENTRY_PROFILE_SESSION_SAMPLE_RATE = 0.05;

/** The scheme `@sentry/electron` carries a renderer's reports to main on, by default. */
const SENTRY_IPC_URL_PREFIX = "sentry-ipc://";

/**
 * Browser tracing's `shouldCreateSpanForRequest`: whether a request is traced.
 * Every request is, except a renderer's reports on their way to main.
 */
export function sentryTracesRequest(url: string): boolean {
  return !url.toLowerCase().startsWith(SENTRY_IPC_URL_PREFIX);
}

/** The spans a send is traced under, one for each kind of send, by the names Sentry lists them by. */
export const SENTRY_SEND_SPAN = {
  /** An agent started: on a task, continued, or forked from another. */
  AGENT_START: "agent.start",
  /** A task created with its first agent. */
  TASK_START: "task.start",
  /** A message sent to an agent. */
  AGENT_SEND: "agent.send",
  /** A message laid in an agent's queue, or a change to it. */
  AGENT_QUEUE: "agent.queue",
} as const;

export type SentrySendSpan = (typeof SENTRY_SEND_SPAN)[keyof typeof SENTRY_SEND_SPAN];

/** The op a send's span is listed under. */
export const SENTRY_SEND_OP = "ui.action.send";

/** The headers Sentry carries a trace in, by its own names, as `getTraceData` answers them. */
export const SENTRY_TRACE_HEADER = {
  TRACE: "sentry-trace",
  BAGGAGE: "baggage",
} as const;

/** The kinds of send span, for telling a send's span from every other by its name. */
const SEND_SPAN_NAMES: ReadonlySet<string> = new Set(Object.values(SENTRY_SEND_SPAN));

/**
 * The clients' `tracesSampler`: a send's span is kept every time, and every
 * other trace by `SENTRY_TRACES_SAMPLE_RATE`, or by its parent's decision
 * where it has one. Note that a send is rare and the trace through the
 * service is what it is for, so a sampled-out send would leave nothing to read.
 */
export function sentryTracesSampler({
  name,
  inheritOrSampleWith,
}: TracesSamplerSamplingContext): number {
  return SEND_SPAN_NAMES.has(name) ? 1 : inheritOrSampleWith(SENTRY_TRACES_SAMPLE_RATE);
}

/** A send's trace, as Sentry's `getTraceData` answered it for the send's span. */
export interface SendTrace {
  readonly sentryTrace: string;
  readonly baggage?: string | undefined;
}

/** The trace the send a host is asked for was pressed under; none for every other call. */
export const SentSendTrace = Context.Reference<SendTrace | undefined>(
  "@repo/features/SentSendTrace",
  { defaultValue: () => undefined },
);

/** A send's trace as headers carry it, Sentry's own names. */
export function sendTraceHeaders(trace: SendTrace): Readonly<Record<string, string>> {
  return {
    [SENTRY_TRACE_HEADER.TRACE]: trace.sentryTrace,
    ...(trace.baggage === undefined ? undefined : { [SENTRY_TRACE_HEADER.BAGGAGE]: trace.baggage }),
  };
}

/** A send's trace read back off the headers that carried it; none where they carry no `sentry-trace`. */
export function sendTraceOf(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): SendTrace | undefined {
  const sentryTrace = headers[SENTRY_TRACE_HEADER.TRACE];
  const baggage = headers[SENTRY_TRACE_HEADER.BAGGAGE];
  if (!Predicate.isString(sentryTrace)) return undefined;
  return { sentryTrace, ...(Predicate.isString(baggage) ? { baggage } : undefined) };
}
