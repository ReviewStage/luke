/**
 * desktop-sentry-sdk.ts -- the chunk `desktop-sentry.ts` loads once a window has drawn: Sentry's Electron renderer SDK, started as Sentry's Electron guide sets up a renderer.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk, and no window's entry carries any of it.
 */

import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@luke/features/sentry-breadcrumbs";
import { SENTRY_TRACES_SAMPLE_RATE, sentryTracesRequest } from "@luke/features/sentry-tracing";
import {
  browserTracingIntegration,
  captureException,
  init,
  withStreamedSpan,
} from "@sentry/electron/renderer";
import { BLANK_WINDOW, type BlankWindow, type DesktopSentry } from "./desktop-sentry";

/** The mechanism each blank window's report names, so Sentry's issue says which path caught it. */
const BLANK_WINDOW_MECHANISM = {
  [BLANK_WINDOW.FIRST_READ]: { type: "auto.electron.renderer.first_read", handled: false },
  [BLANK_WINDOW.RENDER]: { type: "auto.electron.renderer.render", handled: false },
} as const satisfies Record<BlankWindow, { readonly type: string; readonly handled: false }>;

/**
 * Starts the window's SDK with its default data collection and the
 * renderer's filters: a breadcrumb or an event that names an access token is
 * dropped whole, and so is a span that names one as it starts, while every
 * span sent has its addresses scrubbed (`@luke/features/sentry-breadcrumbs`).
 * The DSN, release, and environment are main's, which every renderer event
 * goes through, and its reports reach main as requests of their own, which
 * are never traced (`sentryTracesRequest`).
 */
export function initDesktopSentry(): DesktopSentry {
  init({
    integrations: [browserTracingIntegration({ shouldCreateSpanForRequest: sentryTracesRequest })],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: withStreamedSpan(spanWithoutAccessTokens),
  });
  return {
    reportBlankWindow: (error, why) => {
      captureException(error, { mechanism: BLANK_WINDOW_MECHANISM[why] });
    },
  };
}
