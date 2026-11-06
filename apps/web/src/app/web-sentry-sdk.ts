import { signedInAccountId } from "@repo/credentials/snapshot";
import { readLink } from "@repo/features/link-grammar";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { eventNamingAccount, logNamingAccount } from "@repo/features/sentry-account";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "@repo/features/sentry-breadcrumbs";
import { SENTRY_TRACES_SAMPLE_RATE } from "@repo/features/sentry-tracing";
import { SENTRY_TUNNEL } from "@repo/features/sentry-tunnel";
import { sendShownFailure } from "@repo/features/shown-failure";
import { appStateQuery } from "@repo/panel/use-app-state";
import {
  browserTracingIntegration,
  captureException,
  captureMessage,
  getActiveSpan,
  getClient,
  getCurrentScope,
  init,
  logger,
  startBrowserTracingPageLoadSpan,
  withStreamedSpan,
} from "@sentry/browser";
import type { QueryClient } from "@tanstack/react-query";
import { PANEL_PATH } from "./web-address";
import type { WebSentry, WebSentryBuild } from "./web-sentry";

type Client = NonNullable<ReturnType<typeof getClient>>;

const BLANK_TAB_MECHANISM = { type: "auto.browser.web_root.first_read", handled: false } as const;

const ROUTE_SOURCE = "sentry.segment.name.source";
const SPAN_ORIGIN = "sentry.origin";
const ROUTE = "route";
const PAGELOAD_ORIGIN = "auto.pageload.browser";

function routeName(pathname: string): string {
  const link = readLink(`${LINK_ORIGIN}${pathname}`);
  return link === undefined ? PANEL_PATH : `${PANEL_PATH}/${link.place.kind}`;
}

function pathOf(address: string | undefined): string {
  try {
    return new URL(address ?? location.href, location.origin).pathname;
  } catch {
    return location.pathname;
  }
}

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

function accountId(queryClient: QueryClient): string | undefined {
  return signedInAccountId(queryClient.getQueryData(appStateQuery.queryKey)?.account);
}

export function initWebSentry(build: WebSentryBuild, queryClient: QueryClient): WebSentry {
  init({
    dsn: build.dsn,
    tunnel: SENTRY_TUNNEL.PATH,
    environment: build.environment,
    ...(build.release ? { release: build.release } : undefined),
    integrations: [
      browserTracingIntegration({ instrumentPageLoad: false, enableLongAnimationFrame: true }),
    ],
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeBreadcrumb: withoutAccessTokens,
    beforeSend: (event) =>
      eventWithoutAccessTokens(eventNamingAccount(event, accountId(queryClient))),
    beforeSendLog: (log) => logNamingAccount(log, accountId(queryClient)),
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: withStreamedSpan(spanWithoutAccessTokens),
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
    reportShownFailure: (report) =>
      sendShownFailure({ captureException, logger, getActiveSpan, getCurrentScope }, report),
  };
}
