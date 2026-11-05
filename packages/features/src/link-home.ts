/**
 * link-home.ts -- where a link of ours lives: the host its address is written on, the desktop's own scheme, and the earlier names every reader still takes.
 *
 * A link of ours is the thing's address on the web, `https://<host>/<workspace>/…`,
 * and the desktop is handed the same address with its scheme swapped for the
 * app's own. Both are spelled here and nowhere else. Links were once
 * written at `tryluke.dev` and `tryluke:`, which stand in `LINK_HOST_ALIASES`
 * and `SCHEME_ALIASES` below: every reader goes on taking them as the home's,
 * so no link already pasted anywhere stops opening, and production serves the
 * app at each such host still, as its own (`auth-deployment.ts`'s `ownOrigins`).
 * The bundle's own claim on the scheme (`electron-builder-config.mjs`'s
 * `protocols`) is the one spelling outside this module, since the build reads
 * no TypeScript; a rename names its alias there too.
 */

/** Hosts a link was once written on, read as the home's. */
export const LINK_HOST_ALIASES: readonly string[] = ["tryluke.dev"];

/** Schemes the desktop was once handed a link in, read as its own. */
const SCHEME_ALIASES: readonly string[] = ["tryluke"];

export const LINK_HOME = {
  /** The host every link is written on. */
  HOST: "vespin.dev",
  /** The desktop's own scheme, without its colon, as the bundle registers it with macOS. */
  APP_SCHEME: "vespin",
} as const;

/** The origin every link is written under. */
export const LINK_ORIGIN = `https://${LINK_HOME.HOST}`;

/** The scheme a link is written in for the desktop, its colon after it, as `URL.protocol` spells one. */
const APP_LINK_PROTOCOL = `${LINK_HOME.APP_SCHEME}:`;

/**
 * Our home in the desktop's own scheme. It names no place, so the app
 * opens nothing of it (`app-links.ts`), but macOS still brings the app
 * forward to take it: the link a page hands a Mac to open the app at all.
 */
export const APP_HOME_LINK = `${APP_LINK_PROTOCOL}//${LINK_HOME.HOST}/`;

const HOSTS: ReadonlySet<string> = new Set([LINK_HOME.HOST, ...LINK_HOST_ALIASES]);

const APP_PROTOCOLS: ReadonlySet<string> = new Set(
  [LINK_HOME.APP_SCHEME, ...SCHEME_ALIASES].map((scheme) => `${scheme}:`),
);

/** A literal as a pattern that matches it alone. */
function escapedPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The opening of a link's address in a text, `<scheme>://<host>`, as a
 * pattern: by the web's scheme or the desktop's, on the home's host, or by a
 * scheme or on a host it once had, so a scan of words already kept still
 * finds the links a rename left behind.
 */
export const LINK_HOME_PATTERN = `(?:${["https", LINK_HOME.APP_SCHEME, ...SCHEME_ALIASES]
  .map(escapedPattern)
  .join("|")}):\\/\\/(?:${[...HOSTS].map(escapedPattern).join("|")})`;

/** Whether an address is in the desktop's own scheme, or one it was once handed links in. */
export function isAppLinkProtocol(protocol: string): boolean {
  return APP_PROTOCOLS.has(protocol);
}

/** Whether an address is a link of ours: on the home's host or an alias of it, by the web's scheme or the desktop's. */
export function isLinkHome(url: URL): boolean {
  return HOSTS.has(url.host) && (url.protocol === "https:" || isAppLinkProtocol(url.protocol));
}

/** An address on the home, spelled in the desktop's own scheme. */
export function inAppScheme(address: string): string {
  return `${APP_LINK_PROTOCOL}${address.slice(address.indexOf("//"))}`;
}

/**
 * The first steps of our home's paths that are our own, now or likely soon,
 * which no workspace's slug may be (`workspace-wire.ts`): every page the web
 * app serves under its own name (the root `vercel.json`,
 * `apps/web/vite.config.ts`), the path PostHog's traffic is passed on from
 * (`POSTHOG_PROXY.PATH`), the path the web tab's Sentry envelopes are
 * posted to (`SENTRY_TUNNEL.PATH`), and the words a later page is likeliest to want.
 * It stands here, beside the home it names the paths of, because the link
 * grammar reads it too, so a page of ours is never read as a workspace's
 * Home, and this module imports nothing.
 */
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  "404",
  "about",
  "accept-invitation",
  "account",
  "admin",
  "agents",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "board",
  "changelog",
  "cli",
  "connect",
  "connect-github",
  "consent",
  "dashboard",
  "desktop-session",
  "docs",
  "download",
  "downloads",
  "eve",
  "feed",
  "github-installed",
  "help",
  "home",
  "inbox",
  "install",
  "integration-connected",
  "integrations",
  "invite",
  "join",
  "k7x2",
  "legal",
  "login",
  "logout",
  "mac",
  "mcp",
  "new",
  "notifications",
  "oauth",
  "open",
  "page-in-mac-app",
  "pages",
  "plan",
  "plans",
  "pricing",
  "privacy",
  "r8v3",
  "search",
  "security",
  "settings",
  "sign-in",
  "sign-out",
  "sign-up",
  "status",
  "support",
  "task",
  "tasks",
  "team",
  "teams",
  "terms",
  "workspaces",
]);
