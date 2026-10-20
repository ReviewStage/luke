/**
 * web-sentry-sdk.ts -- the chunk `web-sentry.ts` loads where the build carries a DSN: Sentry's browser SDK, started on the desktop renderer's terms.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk rather than every export a namespace import would
 * hold on to.
 */

import {
  eventWithoutAccessTokens,
  transactionWithoutAccessTokens,
  withoutAccessTokens,
} from "@luke/features/sentry-breadcrumbs";
import { SENTRY_TRACES_SAMPLE_RATE } from "@luke/features/sentry-tracing";
import { browserTracingIntegration, captureException, captureMessage, init } from "@sentry/browser";
import type { WebSentry, WebSentryBuild } from "./web-sentry";

/** The mechanism a blank tab's report names, so Sentry's issue says which path caught it, as the desktop's first read does. */
const BLANK_TAB_MECHANISM = { type: "auto.browser.web_root.first_read", handled: false } as const;

/**
 * Where a refused address is said by no more than its origin, or by the
 * browser's own word for what it refused (`inline`, `eval`), so a path or a
 * query, which may carry a token, never leaves the tab.
 */
function refusedOrigin(blockedURI: string): string {
  try {
    return new URL(blockedURI).origin;
  } catch {
    return blockedURI;
  }
}

/**
 * Each kind of request the page's `Content-Security-Policy` refused, sent to
 * Sentry once per directive and origin as a warning. A refusal says nothing
 * in the page, so a connection the policy forgot (the account inbox's
 * Realtime socket was one) would otherwise fail in silence.
 */
function reportPolicyRefusals(): void {
  const said = new Set<string>();
  document.addEventListener("securitypolicyviolation", (event) => {
    const refused = `${event.effectiveDirective} to ${refusedOrigin(event.blockedURI)}`;
    if (said.has(refused)) return;
    said.add(refused);
    captureMessage(`Content-Security-Policy refused ${refused}`, "warning");
  });
}

/**
 * Starts the SDK with its default data collection, under the build's DSN,
 * environment, and release, and the desktop renderer's filters: a
 * breadcrumb, an event, or a trace that names an access token is dropped
 * whole (`@luke/features/sentry-breadcrumbs`); and every kind of request the
 * page's policy refuses, reported once.
 */
export function initWebSentry(build: WebSentryBuild): WebSentry {
  init({
    dsn: build.dsn,
    environment: build.environment,
    ...(build.release ? { release: build.release } : undefined),
    integrations: [browserTracingIntegration()],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    beforeSendTransaction: transactionWithoutAccessTokens,
  });
  reportPolicyRefusals();
  return {
    reportBlankTab: (error) => {
      captureException(error, { mechanism: BLANK_TAB_MECHANISM });
    },
  };
}
