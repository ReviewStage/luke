/**
 * caller-trace.ts -- the trace a request's caller sent, which the request's server span continues.
 *
 * A client sends a send of its own, an agent started or a message sent,
 * under a Sentry span it opened as the developer pressed, and carries that
 * span's trace as Sentry's own headers, `sentry-trace` and `baggage`, as
 * Sentry's guide to custom trace propagation sets them. Every other call
 * carries Effect's `traceparent`. The server span is continued from the
 * first where it stands and from the second otherwise, so a send's spans on
 * the service sit in the trace its press began.
 *
 * Note that `sentry-trace` is read through Sentry's own `continueTrace`,
 * which answers the trace it would continue (its id, the caller's span, its
 * sampling) or none where the header does not parse or Sentry's own rules
 * refuse it, and that only those three are handed on, as the Effect parent
 * Sentry's tracer continues (`observability/sentry.ts`'s `sentryTelemetry`):
 * Sentry's Effect tracer continues an outside parent from them alone. A
 * header that names no sampling, which leaves the decision to the service, is
 * read as none, so `traceparent` decides it as before. No header value
 * reaches a span or a log line but the ids.
 */

import { SENTRY_TRACE_HEADER } from "@repo/features/sentry-tracing";
import { continueTrace, getCurrentScope } from "@sentry/effect/server";
import { Option, Tracer } from "effect";
import { Headers, HttpTraceContext } from "effect/http";

/** The W3C header Effect's router continues a caller's trace from. */
const TRACEPARENT = "traceparent";

/** The trace `sentry-trace` and `baggage` name, as Sentry would continue it; none where it would start one of its own or leave its sampling open. */
function sentryParent(headers: Headers.Headers): Option.Option<Tracer.ExternalSpan> {
  const sentryTrace = headers[SENTRY_TRACE_HEADER.TRACE];
  if (sentryTrace === undefined) return Option.none();
  const baggage = headers[SENTRY_TRACE_HEADER.BAGGAGE];
  const continued = continueTrace({ sentryTrace, baggage }, () =>
    getCurrentScope().getPropagationContext(),
  );
  const { traceId, parentSpanId, sampled } = continued;
  if (parentSpanId === undefined || sampled === undefined) return Option.none();
  return Option.some(Tracer.externalSpan({ traceId, spanId: parentSpanId, sampled }));
}

/**
 * The parent a request's server span continues: the caller's Sentry trace
 * where it sent one, its `traceparent` otherwise, none where it sent neither
 * or neither parses.
 */
export function callerTrace(headers: Headers.Headers): Option.Option<Tracer.ExternalSpan> {
  return Option.orElse(sentryParent(headers), () => HttpTraceContext.w3c(headers));
}

/** The W3C `traceparent` naming a span, as Effect's own client writes it. */
function traceparentOf({ traceId, spanId, sampled }: Tracer.ExternalSpan): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

/**
 * A request whose `traceparent` names the caller's Sentry trace where it sent
 * one, for a server that reads only `traceparent` (Effect's router, whose
 * request span `HttpMiddleware.tracer` opens); the request as it came
 * otherwise. Note that its body is handed on unread.
 */
export function withSentryTraceparent(request: Request): Request {
  const parent = sentryParent(Headers.fromInput(request.headers));
  if (Option.isNone(parent)) return request;
  const headers = new globalThis.Headers(request.headers);
  headers.set(TRACEPARENT, traceparentOf(parent.value));
  return new Request(request, { headers });
}
