/**
 * auth-policy.ts -- the auth policy constants, apart from the `betterAuth` construction that reads them.
 *
 * `auth.ts` cannot be imported without a database, and what this deployment
 * fixes about sign-in, token storage, key storage, and client privileges is
 * worth asserting without one.
 */

import { DESKTOP_SESSION_CLIENT_ID } from "@luke/features/desktop-session-wire";
import { USER_ROLE } from "../admin/admin-access.js";

/**
 * What a GitHub sign-in asks for. It is the Luke GitHub App's user
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
 * nothing of Luke's reads that token anywhere but on the server
 * (`github/github-app.ts`), and root AGENTS.md pins that no credential
 * travels in an answer, so neither door is open.
 *
 * Every organization write a browser could reach is shut as well, but for
 * the invitations. A session free to create an organization, or to rename
 * its own, could take a slug before the team it belongs to arrives, so
 * workspaces are created, renamed, given a photo, and their members removed
 * only by Luke's server, through the server-only `auth.api` calls, which
 * these paths do not reach; a rename there hands the plugin a name and never
 * a slug, and a photo a logo it has read as one.
 *
 * A teammate joins by invitation, Better Auth's own
 * (https://www.better-auth.com/docs/plugins/organization#invitations). An
 * owner or an admin asks for one, lists and cancels the pending ones from
 * the Mac, through Luke's routes and the server-only calls, so those paths
 * are shut too; the invitee's page reads and accepts theirs on the browser's
 * session, so exactly those two endpoints are served (`get-invitation`,
 * `accept-invitation`). The plugin checks each against the caller's address
 * itself. Rejecting and listing one's own invitations stay shut, since no
 * page of Luke's asks for either. The team
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
 * The user's fields beyond Better Auth's own. Admin access is a plain-text
 * `role` on the user, managed by Better Auth: the migrations declared it on
 * the `user` table, and it is returned on the session so the dashboard reads
 * it without a query of its own. `input: false` keeps a sign-up from
 * asserting its own role — the role is set only by a maintainer's own write
 * to the database, never by anything Luke runs.
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
 * `userId` and carries no session through, which is the one way Luke
 * creates a workspace.
 *
 * An invitation's id is the accept link an owner copies and shares by hand,
 * so it travels outside the invitee's mailbox, which is the case the plugin's
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

/** Luke provisions its own native clients; signed-in users cannot add or alter OAuth clients. */
export function denyOAuthClientPrivileges(): false {
  return false;
}
