/**
 * link-home.ts -- where a Luke link lives: the host its address is written on, the desktop's own scheme, and the earlier names every reader still takes.
 *
 * A Luke link is the thing's address on the web, `https://<host>/<workspace>/…`,
 * and the desktop is handed the same address with its scheme swapped for the
 * app's own (`docs/proposals/web-and-links.md`). The product's name, and so
 * the host and the scheme, may still change, so both are spelled here and
 * nowhere else: a rename is this constant and an alias, the old name moved
 * into `HOST_ALIASES` and `SCHEME_ALIASES` below, which every reader goes on
 * taking as the home's, so no link already pasted anywhere stops opening.
 * The bundle's own claim on the scheme (`electron-builder-config.mjs`'s
 * `protocols`) is the one spelling outside this module, since the build reads
 * no TypeScript; a rename names its alias there too.
 */

/** Hosts a link was once written on, read as the home's. */
const HOST_ALIASES: readonly string[] = [];

/** Schemes the desktop was once handed a link in, read as its own. */
const SCHEME_ALIASES: readonly string[] = [];

export const LINK_HOME = {
  /** The host every link is written on. */
  HOST: "tryluke.dev",
  /** The desktop's own scheme, without its colon, as the bundle registers it with macOS. */
  APP_SCHEME: "tryluke",
} as const;

/** The origin every link is written under. */
export const LINK_ORIGIN = `https://${LINK_HOME.HOST}`;

/** The scheme a link is written in for the desktop, its colon after it, as `URL.protocol` spells one. */
const APP_LINK_PROTOCOL = `${LINK_HOME.APP_SCHEME}:`;

const HOSTS: ReadonlySet<string> = new Set([LINK_HOME.HOST, ...HOST_ALIASES]);

const APP_PROTOCOLS: ReadonlySet<string> = new Set(
  [LINK_HOME.APP_SCHEME, ...SCHEME_ALIASES].map((scheme) => `${scheme}:`),
);

/** Whether an address is in the desktop's own scheme, or one it was once handed links in. */
export function isAppLinkProtocol(protocol: string): boolean {
  return APP_PROTOCOLS.has(protocol);
}

/** Whether an address is a Luke link's: on the home's host or an alias of it, by the web's scheme or the desktop's. */
export function isLinkHome(url: URL): boolean {
  return HOSTS.has(url.host) && (url.protocol === "https:" || isAppLinkProtocol(url.protocol));
}

/** An address on the home, spelled in the desktop's own scheme. */
export function inAppScheme(address: string): string {
  return `${APP_LINK_PROTOCOL}${address.slice(address.indexOf("//"))}`;
}
