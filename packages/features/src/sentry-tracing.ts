/**
 * sentry-tracing.ts -- how much every desktop process traces, and which requests it never traces.
 *
 * Main, the preload, and each window's renderer start their own Sentry SDK,
 * and a renderer's SDK hands every envelope and scope change to main over
 * Electron's `sentry-ipc://` protocol, as a `fetch`. Browser tracing records
 * each `fetch` as a span, so a renderer left to trace everything traced its
 * own reporting: every report it sent was a span, and every span another
 * report. Those requests are Luke talking to itself and are never traced.
 * Note that this sits here rather than in `@luke/host`, because the renderer
 * reads it and may import only three of host's doors.
 */

/** The share of traces kept: enough to read start-up and page-load times by, not every one. */
export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

/** The scheme `@sentry/electron` carries a renderer's reports to main on, by default. */
const SENTRY_IPC_URL_PREFIX = "sentry-ipc://";

/**
 * Browser tracing's `shouldCreateSpanForRequest`: whether a request is traced.
 * Every request is, except a renderer's reports on their way to main.
 */
export function sentryTracesRequest(url: string): boolean {
  return !url.toLowerCase().startsWith(SENTRY_IPC_URL_PREFIX);
}
