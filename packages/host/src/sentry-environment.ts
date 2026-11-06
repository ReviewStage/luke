import type { AppIdentityContext } from "./app-identity.js";

export const SENTRY_ENVIRONMENT = {
  PRODUCTION: "production",
  TEST: "test",
  DEVELOPMENT: "development",
} as const;
export type SentryEnvironment = (typeof SENTRY_ENVIRONMENT)[keyof typeof SENTRY_ENVIRONMENT];

export function sentryEnvironment({
  packaged,
  developerIdSigned,
}: Pick<AppIdentityContext, "packaged" | "developerIdSigned">): SentryEnvironment {
  if (!packaged) return SENTRY_ENVIRONMENT.DEVELOPMENT;
  return developerIdSigned ? SENTRY_ENVIRONMENT.PRODUCTION : SENTRY_ENVIRONMENT.TEST;
}
