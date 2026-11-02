/**
 * posthog-proxy.ts -- where a browser on our own origin sends PostHog's traffic, and where the web service passes it on.
 *
 * Ad blockers refuse PostHog's own hosts, so the site's counting and the web
 * app's recording post to a path on whichever origin served the page, and
 * the web service rewrites it onto PostHog (`apps/web/server/function-rewrites.ts`),
 * as PostHog's own Vercel proxy guide lays out. The path is no word a
 * blocklist knows (`/ingest`, `/posthog`), and no workspace's slug may take
 * it (`RESERVED_WORKSPACE_SLUGS`). The desktop's panel window is a `file://`
 * page no blocker sees, so it posts to PostHog directly. It imports nothing,
 * so the site's pages may read it without its bundle growing.
 */

export const POSTHOG_PROXY = {
  /** The path on our own origin a browser posts PostHog's traffic to, the client's `api_host`. */
  PATH: "/k7x2",
  /** PostHog's ingestion host, which everything under `PATH` but its assets is passed on to. */
  INGEST_ORIGIN: "https://us.i.posthog.com",
  /** PostHog's assets host, which `PATH`'s `static/` and `array/` are passed on to. */
  ASSETS_ORIGIN: "https://us-assets.i.posthog.com",
  /** PostHog's own app, which a link the client draws into PostHog opens, its `ui_host`. */
  UI_ORIGIN: "https://us.posthog.com",
} as const;
