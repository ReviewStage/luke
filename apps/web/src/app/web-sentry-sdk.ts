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

/** The browser's own words for what it refused that names no address, said as they are. */
const REFUSAL_KEYWORDS: ReadonlySet<string> = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "data",
  "blob",
  "trusted-types-policy",
  "trusted-types-sink",
]);

/** What a refusal says of an address it could not read, in place of the address. */
const UNREADABLE_ADDRESS = "an unreadable address";

/**
 * Where a refused address is said by no more than its origin, or by the
 * browser's own word for what it refused (`inline`, `eval`), so a path or a
 * query, which may carry a token, never leaves the tab; anything else is
 * said as unreadable rather than as it came.
 */
function refusedOrigin(blockedURI: string): string {
  if (REFUSAL_KEYWORDS.has(blockedURI)) return blockedURI;
  try {
    const { origin } = new URL(blockedURI);
    return origin === "null" ? UNREADABLE_ADDRESS : origin;
  } catch {
    return UNREADABLE_ADDRESS;
  }
}

/** Whether this document already listens for refusals, so a second start of the SDK in the same tab adds no second listener. */
let listeningForRefusals = false;

/**
 * Each kind of request the page's `Content-Security-Policy` refused, sent to
 * Sentry once per directive and origin as a warning, from one listener per
 * document however often the SDK starts. A refusal says nothing in the page,
 * so a connection the policy forgot (the account inbox's Realtime socket was
 * one) would otherwise fail in silence.
 */
function reportPolicyRefusals(): void {
  if (listeningForRefusals) return;
  listeningForRefusals = true;
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
