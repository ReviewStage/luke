/**
 * web-sentry-sdk.ts -- the chunk `web-sentry.ts` loads where the build carries a DSN: Sentry's browser SDK, started on the desktop renderer's terms.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk rather than every export a namespace import would
 * hold on to.
 */

import { SENTRY_TRACES_SAMPLE_RATE } from "@luke/features/sentry-tracing";
import { browserTracingIntegration, captureException, init } from "@sentry/browser";
import type { WebSentry, WebSentryBuild } from "./web-sentry";

/** Starts the SDK with its default data collection, under the build's DSN, environment, and release. */
export function initWebSentry(build: WebSentryBuild): WebSentry {
  init({
    dsn: build.dsn,
    environment: build.environment,
    ...(build.release ? { release: build.release } : undefined),
    integrations: [browserTracingIntegration()],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  });
  return {
    captureUnhandled: (error, mechanism) => {
      captureException(error, { mechanism: { type: mechanism, handled: false } });
    },
  };
}
