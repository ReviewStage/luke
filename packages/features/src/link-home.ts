export const LINK_HOST_ALIASES: readonly string[] = ["tryluke.dev"];

const SCHEME_ALIASES: readonly string[] = ["tryluke"];

export const LINK_HOME = {
  HOST: "vespin.dev",
  APP_SCHEME: "vespin",
} as const;

export const LINK_ORIGIN = `https://${LINK_HOME.HOST}`;

const APP_LINK_PROTOCOL = `${LINK_HOME.APP_SCHEME}:`;

export const APP_HOME_LINK = `${APP_LINK_PROTOCOL}//${LINK_HOME.HOST}/`;

const HOSTS: ReadonlySet<string> = new Set([LINK_HOME.HOST, ...LINK_HOST_ALIASES]);

const APP_PROTOCOLS: ReadonlySet<string> = new Set(
  [LINK_HOME.APP_SCHEME, ...SCHEME_ALIASES].map((scheme) => `${scheme}:`),
);

function escapedPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export const LINK_HOME_PATTERN = `(?:${["https", LINK_HOME.APP_SCHEME, ...SCHEME_ALIASES]
  .map(escapedPattern)
  .join("|")}):\\/\\/(?:${[...HOSTS].map(escapedPattern).join("|")})`;

export function isAppLinkProtocol(protocol: string): boolean {
  return APP_PROTOCOLS.has(protocol);
}

export function isLinkHome(url: URL): boolean {
  return HOSTS.has(url.host) && (url.protocol === "https:" || isAppLinkProtocol(url.protocol));
}

export function inAppScheme(address: string): string {
  return `${APP_LINK_PROTOCOL}${address.slice(address.indexOf("//"))}`;
}

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
  "mintlify-assets",
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
