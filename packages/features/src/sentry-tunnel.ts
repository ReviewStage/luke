/**
 * sentry-tunnel.ts -- where the web tab posts Sentry's envelopes on our own origin, and the route that passes them on.
 *
 * Tracker blockers (Brave Shields, uBlock, and the lists they read) refuse
 * Sentry's ingest host, so a tab that fails to draw on those browsers would
 * report nothing. The web tab's SDK posts each envelope to a path on whichever
 * origin served the page instead (the SDK's `tunnel`), and the web service
 * rewrites it onto `ROUTE`, which forwards an envelope for the deployment's
 * own project to Sentry and refuses any other
 * (`@repo/service/observability/sentry-tunnel-app`). As PostHog's path is
 * (`@repo/features/posthog-proxy`), the path is no word a blocklist knows, and
 * no workspace's slug may take it (`RESERVED_WORKSPACE_SLUGS`). The desktop's
 * Sentry is no page a blocker sees, so it posts to Sentry directly. It imports
 * nothing, so the web tab may read it without its bundle growing.
 */

export const SENTRY_TUNNEL = {
  /** The path on our own origin the web tab posts its envelopes to, the SDK's `tunnel`. */
  PATH: "/r8v3",
  /** The route the web service rewrites `PATH` onto. */
  ROUTE: "/api/envelopes/forward",
  /** The most an envelope may weigh; the browser SDK sends no attachment, so one event's is far below it. */
  MAX_BODY_BYTES: 1024 * 1024,
} as const;
