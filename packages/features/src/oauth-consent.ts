import { PRODUCT_NAME } from "./product-name.js";

export const OAUTH_SCOPE = {
  OPENID: "openid",
  PROFILE: "profile",
  EMAIL: "email",
  OFFLINE_ACCESS: "offline_access",
  MCP: "vespin:mcp",
} as const;

type OAuthScope = (typeof OAUTH_SCOPE)[keyof typeof OAUTH_SCOPE];

const OAUTH_SCOPE_WORDS = {
  [OAUTH_SCOPE.OPENID]: `Know which ${PRODUCT_NAME} account is yours`,
  [OAUTH_SCOPE.PROFILE]: "See your name and profile picture",
  [OAUTH_SCOPE.EMAIL]: "See your email address",
  [OAUTH_SCOPE.OFFLINE_ACCESS]: "Keep this access after you close the window",
  [OAUTH_SCOPE.MCP]: `See and change your tasks, agents, and inbox in ${PRODUCT_NAME}, as you`,
} as const satisfies Record<OAuthScope, string>;

export const ON_THIS_COMPUTER = "an app on this computer";

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

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

export function oauthScopeLines(scope: string): readonly string[] {
  const asked = new Set(scope.split(" ").filter((each) => each !== ""));
  return [...asked].map((each) => (knownScope(each) ? OAUTH_SCOPE_WORDS[each] : each));
}

export function oauthRedirectDestination(redirectUri: string): string {
  if (!URL.canParse(redirectUri)) return redirectUri;
  const url = new URL(redirectUri);
  return onThisComputer(url) ? ON_THIS_COMPUTER : url.host;
}
