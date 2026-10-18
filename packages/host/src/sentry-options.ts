/**
 * sentry-options.ts -- what every desktop process tells Sentry alike: how much it traces, which requests it never traces, and the environment a build reports under.
 *
 * Main, the preload, and each window's renderer start their own Sentry SDK,
 * and a renderer's SDK hands every envelope and scope change to main over
 * Electron's `sentry-ipc://` protocol, as a `fetch`. Browser tracing records
 * each `fetch` as a span, so a renderer left to trace everything traced its
 * own reporting: every report it sent was a span, and every span another
 * report. Those requests are Luke talking to itself and are never traced.
 */

import type { AppIdentityContext } from "./app-identity.js";

/** The share of traces kept: enough to read start-up and page-load times by, not every one. */
export const SENTRY_TRACES_SAMPLE_RATE = 0.1;

/** The scheme `@sentry/electron` carries a renderer's reports to main on, by default. */
const SENTRY_IPC_URL_PREFIX = "sentry-ipc://";

/** The environment a build's reports are filed under; the release is the same `Luke@X.Y.Z` for each. */
export const SENTRY_ENVIRONMENT = {
  /** A packaged build signed with the Developer ID: what users run. */
  PRODUCTION: "production",
  /** A locally packaged, ad-hoc signed build (`Luke Test`). */
  TEST: "test",
  /** `electron .` (`Luke Dev`), a named instance among them. */
  DEVELOPMENT: "development",
} as const;
export type SentryEnvironment = (typeof SENTRY_ENVIRONMENT)[keyof typeof SENTRY_ENVIRONMENT];

/**
 * Browser tracing's `shouldCreateSpanForRequest`: whether a request is traced.
 * Every request is, except a renderer's reports on their way to main.
 */
export function sentryTracesRequest(url: string): boolean {
  return !url.toLowerCase().startsWith(SENTRY_IPC_URL_PREFIX);
}

/**
 * The environment this build reports under, decided by the same two facts as
 * the name it answers to (`resolveAppName`), so that a test or development
 * build's reports never read as a release's.
 */
export function sentryEnvironment({
  packaged,
  developerIdSigned,
}: Pick<AppIdentityContext, "packaged" | "developerIdSigned">): SentryEnvironment {
  if (!packaged) return SENTRY_ENVIRONMENT.DEVELOPMENT;
  return developerIdSigned ? SENTRY_ENVIRONMENT.PRODUCTION : SENTRY_ENVIRONMENT.TEST;
}
