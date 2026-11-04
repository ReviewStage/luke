/**
 * auth-policy.ts -- the auth policy constants, apart from the `betterAuth` construction that reads them.
 *
 * `auth.ts` cannot be imported without a database, and what this deployment
 * fixes about sign-in, token storage, key storage, and client privileges is
 * worth asserting without one.
 */

import type { CimdOptions } from "@better-auth/cimd";
import type { ClientMetadataResourceFetch, OAuthOptions, Scope } from "@better-auth/oauth-provider";
import { DESKTOP_SESSION_CLIENT_ID } from "@repo/features/desktop-session-wire";
import { USER_ROLE } from "../admin/admin-access.js";
import { MEMBER_MCP_SCOPE } from "../member-mcp/resource.js";

/**
 * The page the OAuth provider sends an authorization that holds no session
 * to, whose sign-in resumes it. The local server's demo sign-in answers this
 * path in the page's place (`apps/web/server/local-sign-in.ts`).
 */
export const LOGIN_PAGE = "/sign-in";

/**
 * The path every auth endpoint stands under, Better Auth's own default,
 * declared so the issuer a token names (`${baseURL}/api/auth`) and the path
 * set the auth group serves are one spelling.
 */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * The scopes the OAuth provider knows: OpenID's own, which the desktop asks
 * for, and the member MCP server's, which a client of it asks for
 * (`../member-mcp/resource.ts`). A client's row narrows these to its own,
 * so naming the MCP scope here hands it to no client that was not
 * registered with it.
 */
export const OAUTH_PROVIDER_SCOPES = [
  "openid",
  "profile",
  "email",
  MEMBER_MCP_SCOPE.OFFLINE_ACCESS,
  MEMBER_MCP_SCOPE.MCP,
] as const;

/**
 * How an outside MCP client comes to hold a client row, by either door the
 * provider opens: Dynamic Client Registration (RFC 7591) at
 * `/oauth2/register`, open to anyone since a client registers before a
 * member signs in, and a Client ID Metadata Document (`memberMcpClientDiscovery`
 * below), fetched from the URL the client names itself by. Both doors persist
 * the same capability set (the plugin's one registration seam): the member
 * MCP server's scopes alone, with no step-up beyond them, so no such client
 * is ever granted `openid` and its token names no member to the account
 * routes, which resolve through userinfo. A registration or a document that
 * asks for a scope outside the set is refused `invalid_scope`.
 *
 * No link to the resource is written (`enforcePerClientResources: false`):
 * the plugin's default of linking at registration
 * (`clientRegistrationDefaultResources`) is refused at init unless the
 * resource is also declared through its `resources` option, whose seed
 * queries the store as this module loads, which `auth-database.ts` says no
 * import may. With one resource a deployment, the member MCP server, whose
 * row allows only these scopes, the link would hold nothing the scopes do
 * not: the desktop's client holds no `vespin:mcp`, so a token it minted for
 * the resource is refused there for its scope.
 */
export function oauthClientRegistration(): Pick<
  OAuthOptions<Scope[]>,
  | "allowDynamicClientRegistration"
  | "allowUnauthenticatedClientRegistration"
  | "clientRegistrationDefaultScopes"
  | "clientRegistrationAllowedScopes"
  | "enforcePerClientResources"
> {
  return {
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultScopes: [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
    clientRegistrationAllowedScopes: [],
    enforcePerClientResources: false,
  };
}

/**
 * The protocol profile a Client ID Metadata Document is held to: the MCP
 * 2026-07-28 revision's, which the member MCP server serves and which
 * requires a document to name the client (`client_name`, what the consent
 * page shows) and its redirects.
 */
const MCP_METADATA_PROFILE = "mcp-2026-07-28" as const satisfies CimdOptions["metadataProfile"];

/**
 * How a client named by the URL of its Client ID Metadata Document is
 * discovered (`@better-auth/cimd`): its document fetched through the
 * transport given, on a deployment the package's own Node fetch, which
 * resolves the host once, refuses every special-use address, pins the
 * answer for the connection, and follows no redirect; in a test, a double.
 * The plugin's own gates stand and no host allowlist is set
 * (`isMetadataDocumentUrlAllowed`): an allowlist would shut out every client
 * nobody named, and what a document claims is weighed on the consent page,
 * which shows the client's registered name and where its answer goes.
 */
export function memberMcpClientDiscovery(
  fetchClientMetadataResource: ClientMetadataResourceFetch,
): CimdOptions {
  return { fetchClientMetadataResource, metadataProfile: MCP_METADATA_PROFILE };
}

/**
 * Better Auth's rate limiter, on its database storage (`rate_limit` in the
 * auth schema), so a count holds across the deployment's function instances
 * rather than each instance keeping its own: the provider's own rules are
 * what is counted, among them five registrations a minute per address at
 * `/oauth2/register`, the one door open to anyone. It is on in every
 * environment rather than only where `NODE_ENV` says production, so a
 * Preview is held to the same limits.
 */
export const AUTH_RATE_LIMIT = { enabled: true, storage: "database" } as const;

/**
 * The headers the platform names a request's address in, read in this order:
 * Vercel sets both and overwrites any a caller sent
 * (`agents/device-agents-procedures.ts` reads the same two), and the first
 * holds one address where the second may list a chain, which the limiter
 * would not key on.
 */
export const CLIENT_ADDRESS_HEADERS = ["x-real-ip", "x-forwarded-for"] as const;

/**
 * What a GitHub sign-in asks for. It is our GitHub App's user
 * authorization, and a GitHub App has permissions rather than scopes: what
 * the token reaches is fixed by the App's registration (repository metadata,
 * contents, and pull requests where the App is installed and the user has
 * access, and the user's email addresses), so the request names no OAuth
 * scope, and Better Auth's own `read:user user:email` default is switched off
 * rather than sent for GitHub to ignore.
 */
export const GITHUB_SIGN_IN = {
  disableDefaultScope: true,
} as const;

/**
 * How Better Auth keeps and links an account's provider rows. Every token is
 * sealed under the session secret. A sign-in refreshes the row it signs in
 * through, which is how an account that signed in through the OAuth App
 * before the GitHub App comes to hold the App's token and refresh token.
 *
 * A signed-in account may link GitHub to itself whatever address GitHub
 * holds (`allowDifferentEmails`), since an account made with Google and
 * the GitHub it plans against rarely share one; the link is the account's
 * own deliberate act, made from its session. Sign-in still links on its own
 * only where the provider verified the same address, Better Auth's default:
 * no provider is trusted past that (`trustedProviders`), which the docs warn
 * risks an account takeover
 * (https://www.better-auth.com/docs/concepts/users-accounts#account-linking).
 */
export const ACCOUNT_TOKEN_STORAGE = {
  encryptOAuthTokens: true,
  updateAccountOnSignIn: true,
  accountLinking: { enabled: true, allowDifferentEmails: true },
} as const;

/**
 * The Better Auth endpoints this deployment does not serve. `/token` is the
 * JWT plugin's, which the OAuth provider's own token endpoint stands in for.
 * The other two would hand a signed-in browser its GitHub access token:
 * nothing of ours reads that token anywhere but on the server
 * (`github/github-app.ts`), and root AGENTS.md pins that no credential
 * travels in an answer, so neither door is open.
 *
 * Every organization write a browser could reach is shut as well, but for
 * the invitations. A session free to create an organization, or to rename
 * its own, could take a slug before the team it belongs to arrives, so
 * workspaces are created, renamed, given a photo, and their members removed
 * only by our server, through the server-only `auth.api` calls, which
 * these paths do not reach; a rename there hands the plugin a name and never
 * a slug, and a photo a logo it has read as one.
 *
 * A teammate joins by invitation, Better Auth's own
 * (https://www.better-auth.com/docs/plugins/organization#invitations). An
 * owner or an admin asks for one, lists and cancels the pending ones from
 * the Mac, through our routes and the server-only calls, so those paths
 * are shut too; the invitee's page reads and accepts theirs on the browser's
 * session, so exactly those two endpoints are served (`get-invitation`,
 * `accept-invitation`). The plugin checks each against the caller's address
 * itself. Rejecting and listing one's own invitations stay shut, since no
 * page of ours asks for either. The team
 * and role endpoints are listed although this deployment does not mount
 * them, so turning either option on later opens no door by itself.
 *
 * The Electron plugin's `/electron/init-oauth-proxy` starts a sign-in of
 * its own; the Mac signs in through its OAuth authorization and only then
 * asks the plugin to transfer the signed-in browser, so that door is shut.
 */
export const DISABLED_AUTH_PATHS = [
  "/token",
  "/get-access-token",
  "/refresh-token",
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/check-slug",
  "/organization/set-active",
  "/organization/add-member",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/leave",
  "/organization/invite-member",
  "/organization/list-invitations",
  "/organization/cancel-invitation",
  "/organization/reject-invitation",
  "/organization/list-user-invitations",
  "/organization/create-team",
  "/organization/update-team",
  "/organization/remove-team",
  "/organization/set-active-team",
  "/organization/add-team-member",
  "/organization/remove-team-member",
  "/organization/create-role",
  "/organization/update-role",
  "/organization/delete-role",
  "/electron/init-oauth-proxy",
] as const;

/**
 * How a session is carried where no cookie is: Better Auth's bearer plugin
 * (https://www.better-auth.com/docs/plugins/bearer) reads `Authorization:
 * Bearer` as the session cookie. Only the signed token it hands out in
 * `set-auth-token` is taken, never a bare session token, so a token is
 * worth nothing without this deployment's secret having signed it.
 */
export const SESSION_BEARER = { requireSignature: true } as const;

/**
 * How long a browser's session is read from a cookie of its own rather than
 * the account store: Better Auth's cookie cache
 * (https://www.better-auth.com/docs/concepts/session-management#cookie-cache),
 * a `session_data` cookie beside the session's own, encrypted under the
 * deployment's secret (`jwe`: neither readable nor alterable by whoever holds
 * it) and honored only beside the signed session cookie it was minted for.
 * Note that a session revoked elsewhere, or a role changed in the store,
 * still reads as it was on a browser holding that cookie for up to
 * `maxAge`, which Better Auth's docs name as the cost, so `maxAge` is the
 * shortest they suggest. The Mac's session bearer carries no such cookie, so
 * it is read from the store every time.
 */
export const SESSION_COOKIE_CACHE = {
  cookieCache: { enabled: true, maxAge: 60, strategy: "jwe" },
} as const;

/**
 * The user's fields beyond Better Auth's own. Admin access is a plain-text
 * `role` on the user, managed by Better Auth: the migrations declared it on
 * the `user` table, and it is returned on the session so the dashboard reads
 * it without a query of its own. `input: false` keeps a sign-up from
 * asserting its own role — the role is set only by a maintainer's own write
 * to the database, never by anything we run.
 */
export const USER_FIELDS = {
  additionalFields: {
    role: { type: "string", required: false, defaultValue: USER_ROLE.USER, input: false },
  },
} as const;

/**
 * Better Auth's Electron plugin
 * (https://www.better-auth.com/docs/integrations/electron), which mints the
 * Mac a session of its own from a signed-in browser through a single-use,
 * PKCE-bound code. Its client id is not the Mac's OAuth client id: the
 * plugin's sign-in hook reads a `client_id` and a `code_challenge` off the
 * query, which the OAuth authorization also carries.
 */
export const DESKTOP_SESSION = { clientID: DESKTOP_SESSION_CLIENT_ID } as const;

/**
 * How Better Auth keeps workspaces, each an organization of its members. A
 * workspace is never deleted, so no task is lost with one, and no signed-in
 * user creates one: the plugin still lets a server-only call that names a
 * `userId` and carries no session through, which is the one way we
 * create a workspace.
 *
 * An invitation's id is the accept link the service emails the invitee and
 * an owner may also copy and share by hand, so it can travel outside the
 * invitee's mailbox, which is the case the plugin's
 * `requireEmailVerificationOnInvitation` names: only an account whose
 * provider verified the invited address reads or accepts it.
 */
export const ORGANIZATION_OPTIONS = {
  allowUserToCreateOrganization: false,
  disableOrganizationDeletion: true,
  requireEmailVerificationOnInvitation: true,
} as const;

export const JWT_KEY_STORAGE = {
  jwks: {
    disablePrivateKeyEncryption: false,
  },
} as const;

/** We provision our own native clients; signed-in users cannot add or alter OAuth clients. */
export function denyOAuthClientPrivileges(): false {
  return false;
}

/** The resources are declared in code and seeded from it (`auth.ts`); signed-in users cannot add, alter, or link OAuth resources. */
export function denyOAuthResourcePrivileges(): false {
  return false;
}
