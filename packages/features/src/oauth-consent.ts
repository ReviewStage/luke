import { PRODUCT_NAME } from "./product-name.js";

/**
 * oauth-consent.ts -- what the consent page says of an OAuth client's request: one plain line per scope it asks for, and where its answer goes.
 *
 * A client that is not trusted stops on the consent page until the member
 * answers, and the page says what the client will be able to do in the
 * member's words rather than the protocol's. A scope these words do not know
 * is listed by its own name, never hidden, so a member is never asked to
 * allow more than the page shows.
 */

/**
 * The scopes our authorization server grants, by name: OpenID's own, which
 * the desktop asks for, and the member MCP server's, which an outside MCP
 * client asks for and which the service's resource names back
 * (`@repo/service/member-mcp/resource`). Declared here, below the service,
 * so the consent page's words and the server's scope are one spelling.
 */
export const OAUTH_SCOPE = {
  OPENID: "openid",
  PROFILE: "profile",
  EMAIL: "email",
  OFFLINE_ACCESS: "offline_access",
  MCP: "vespin:mcp",
} as const;

type OAuthScope = (typeof OAUTH_SCOPE)[keyof typeof OAUTH_SCOPE];

/** What each scope lets a client do, one checked row each on the consent page. */
const OAUTH_SCOPE_WORDS = {
  [OAUTH_SCOPE.OPENID]: `Know which ${PRODUCT_NAME} account is yours`,
  [OAUTH_SCOPE.PROFILE]: "See your name and profile picture",
  [OAUTH_SCOPE.EMAIL]: "See your email address",
  [OAUTH_SCOPE.OFFLINE_ACCESS]: "Keep this access after you close the window",
  [OAUTH_SCOPE.MCP]: `See and change your tasks, agents, and inbox in ${PRODUCT_NAME}, as you`,
} as const satisfies Record<OAuthScope, string>;

/** Where a client's answer goes when its redirect is on the member's own machine. */
export const ON_THIS_COMPUTER = "an app on this computer";

/** The loopback names a native client's redirect may stand at (RFC 8252 §7.3). */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

/**
 * An IPv4 loopback address, as the URL parser writes every IPv4 host out in
 * four decimal parts; a name that only begins `127.` is a host on the web.
 */
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

/** The schemes a redirect to a host on the web uses; any other is an app's own. */
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

function knownScope(scope: string): scope is OAuthScope {
  return Object.hasOwn(OAUTH_SCOPE_WORDS, scope);
}

function onThisComputer(url: URL): boolean {
  return (
    !WEB_PROTOCOLS.has(url.protocol) ||
    LOOPBACK_HOSTNAMES.has(url.hostname) ||
    LOOPBACK_IPV4.test(url.hostname)
  );
}

/**
 * One line for each scope in `scope`, the space-separated list an
 * authorization carries, in the order asked and each once: its words, or its
 * own name where these words know none.
 */
export function oauthScopeLines(scope: string): readonly string[] {
  const asked = new Set(scope.split(" ").filter((each) => each !== ""));
  return [...asked].map((each) => (knownScope(each) ? OAUTH_SCOPE_WORDS[each] : each));
}

/**
 * Where a client's answer goes, as the consent page names it: the host of
 * its redirect, or an app on this computer where the redirect is a loopback
 * address or an app's own scheme, since a host there names nothing a member
 * would know.
 */
export function oauthRedirectDestination(redirectUri: string): string {
  if (!URL.canParse(redirectUri)) return redirectUri;
  const url = new URL(redirectUri);
  return onThisComputer(url) ? ON_THIS_COMPUTER : url.host;
}
