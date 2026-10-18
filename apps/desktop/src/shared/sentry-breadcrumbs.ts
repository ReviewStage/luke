/**
 * sentry-breadcrumbs.ts -- the breadcrumbs and events a renderer's crash reports may carry: none that carries a LiveKit access token.
 *
 * A renderer's `fetch`, XHR, and console become Sentry breadcrumbs, and the
 * panel's avatar session joins a LiveKit room whose failed join asks
 * `https://<host>/rtc/v1/validate?access_token=…`, the grant's own token in
 * the query. That token may reach the panel and never a crash report,
 * so a breadcrumb that names one anywhere it carries text is dropped whole
 * rather than redacted: a URL or a console line is free text, and a pattern
 * that missed one spelling would send the rest. An event is held to the same
 * rule, since a failed join's error can carry the same URL in its message,
 * and so is a trace, since browser tracing records each request as a span
 * whose description and data carry its URL. Every renderer's page, its
 * preload, and main all report, so all three drop them.
 */

import type { Breadcrumb, ErrorEvent } from "@sentry/electron/renderer";
import { Predicate } from "effect";

/** The query parameter LiveKit carries the participant token in. */
const ACCESS_TOKEN_PARAMETER = "access_token";

function namesAccessToken(texts: readonly unknown[]): boolean {
  return texts.some((text) => Predicate.isString(text) && text.includes(ACCESS_TOKEN_PARAMETER));
}

/** Whether a breadcrumb's text names the token, in its message or its request's URL. */
function carriesAccessToken(breadcrumb: Breadcrumb): boolean {
  return namesAccessToken([breadcrumb.message, breadcrumb.data?.url]);
}

/** Sentry's `beforeBreadcrumb`: the breadcrumb as it was, or nothing where it carries a token. */
export function withoutAccessTokens(breadcrumb: Breadcrumb): Breadcrumb | null {
  return carriesAccessToken(breadcrumb) ? null : breadcrumb;
}

/**
 * Sentry's `beforeSend`: the event as it was, or nothing where its message,
 * an exception's message, or its request's URL names the token.
 */
export function eventWithoutAccessTokens(event: ErrorEvent): ErrorEvent | null {
  const exceptions = event.exception?.values ?? [];
  const texts = [event.message, event.request?.url, ...exceptions.map((caught) => caught.value)];
  return namesAccessToken(texts) ? null : event;
}

/**
 * Sentry's `beforeSendTransaction`: the trace as it was, or nothing where any
 * of it names the token. A span's URL sits in its description and in fields
 * whose names differ by integration, so the whole event's text is read.
 */
export function transactionWithoutAccessTokens<Trace extends object>(event: Trace): Trace | null {
  return namesAccessToken([JSON.stringify(event)]) ? null : event;
}
