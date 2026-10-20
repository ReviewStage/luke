/**
 * web-sentry-sdk.ts -- the chunk `web-sentry.ts` loads where the build carries a DSN: Sentry's browser SDK, started on the desktop renderer's terms, with transactions named by route.
 *
 * A module of its own, naming what it uses of the SDK, so the bundler keeps
 * only that in the chunk rather than every export a namespace import would
 * hold on to.
 */

import { LINK_ORIGIN } from "@luke/features/link-home";
import { readLink } from "@luke/features/luke-link";
import {
  eventWithoutAccessTokens,
  transactionWithoutAccessTokens,
  withoutAccessTokens,
} from "@luke/features/sentry-breadcrumbs";
import { SENTRY_TRACES_SAMPLE_RATE } from "@luke/features/sentry-tracing";
import {
  browserTracingIntegration,
  captureException,
  captureMessage,
  getClient,
  init,
  startBrowserTracingPageLoadSpan,
} from "@sentry/browser";
import type { WebSentry, WebSentryBuild } from "./web-sentry";

/** The SDK's client, as `getClient` answers it once `init` stands. */
type Client = NonNullable<ReturnType<typeof getClient>>;

/** The mechanism a blank tab's report names, so Sentry's issue says which path caught it, as the desktop's first read does. */
const BLANK_TAB_MECHANISM = { type: "auto.browser.web_root.first_read", handled: false } as const;

/** The route every transaction of the tab is named under, as session replay names every address of it (`web-session-replay.ts`). */
const PANEL_ROUTE = "/app";

/**
 * What a span named by route says of its name, under Sentry's own attribute
 * names (`@sentry/conventions`, which the SDK does not export): that it is a
 * route, which Sentry groups by, and which path started it.
 */
const ROUTE_SOURCE = "sentry.segment.name.source";
const SPAN_ORIGIN = "sentry.origin";
const ROUTE = "route";
const PAGELOAD_ORIGIN = "auto.pageload.browser";

/**
 * The route a tab's path is named by: the kind of place the Luke link it is
 * names (`/app/task`, `/app/agent`), and the panel's own route for any path
 * naming none, so no workspace's slug and no id becomes a transaction's
 * name.
 */
function routeName(pathname: string): string {
  const link = readLink(`${LINK_ORIGIN}${pathname}`);
  return link === undefined ? PANEL_ROUTE : `${PANEL_ROUTE}/${link.place.kind}`;
}

/** The path of an address the tab navigated to, or the tab's own where none is said. */
function pathOf(address: string | undefined): string {
  try {
    return new URL(address ?? location.href, location.origin).pathname;
  } catch {
    return location.pathname;
  }
}

/**
 * Names the page load and every navigation by route, as Sentry's guide to a
 * custom router has it: the page load is started here by its route rather
 * than by the integration by its path, and each navigation is renamed as it
 * starts. The scope's transaction name, which every error event carries, is
 * set from the same name, so neither a span nor an error names a slug or an
 * id.
 *
 * Note that a navigation's options are changed in place, because the SDK
 * reads the name off this same object, after this hook, both to start the
 * span and to name the scope's transaction.
 */
function nameByRoute(client: Client): void {
  client.on("beforeStartNavigationSpan", (options, navigation) => {
    options.name = routeName(pathOf(navigation?.url));
    options.attributes = { ...options.attributes, [ROUTE_SOURCE]: ROUTE };
  });
  startBrowserTracingPageLoadSpan(client, {
    name: routeName(location.pathname),
    attributes: { [ROUTE_SOURCE]: ROUTE, [SPAN_ORIGIN]: PAGELOAD_ORIGIN },
  });
}

/**
 * Starts the SDK with its default data collection, under the build's DSN,
 * environment, and release, and the desktop renderer's filters: a
 * breadcrumb, an event, or a trace that names an access token is dropped
 * whole (`@luke/features/sentry-breadcrumbs`). Each page load and
 * navigation is named by the kind of place it opens, never its path.
 */
export function initWebSentry(build: WebSentryBuild): WebSentry {
  init({
    dsn: build.dsn,
    environment: build.environment,
    ...(build.release ? { release: build.release } : undefined),
    integrations: [
      // The page load is started by route below, rather than by its path here.
      browserTracingIntegration({ instrumentPageLoad: false }),
    ],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: eventWithoutAccessTokens,
    beforeSendTransaction: transactionWithoutAccessTokens,
  });
  const client = getClient();
  if (client !== undefined) nameByRoute(client);
  return {
    reportBlankTab: (error) => {
      captureException(error, { mechanism: BLANK_TAB_MECHANISM });
    },
    captureException: (error, hint) => captureException(error, hint),
    reportRefusal: (directive, origin) => {
      captureMessage(`Content-Security-Policy refused ${directive} to ${origin}`, "warning");
    },
  };
}
