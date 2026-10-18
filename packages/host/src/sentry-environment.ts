/**
 * sentry-environment.ts -- the environment a desktop build's Sentry reports are filed under, by which Luke it is.
 */

import type { AppIdentityContext } from "./app-identity.js";

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
