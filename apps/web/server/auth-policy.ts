/**
 * auth-policy.ts -- the auth policy constants, apart from the `betterAuth` construction that reads them.
 *
 * `auth.ts` cannot be imported without a database, and what this deployment
 * fixes about sign-in, token storage, key storage, and client privileges is
 * worth asserting without one.
 */

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
 * How Better Auth keeps an account's provider rows. Every token is sealed
 * under the session secret. A sign-in refreshes the row it signs in through,
 * which is how an account that signed in through the OAuth App before the
 * GitHub App comes to hold the App's token and refresh token.
 */
export const ACCOUNT_TOKEN_STORAGE = {
  encryptOAuthTokens: true,
  updateAccountOnSignIn: true,
} as const;

/**
 * The Better Auth endpoints this deployment does not serve. `/token` is the
 * JWT plugin's, which the OAuth provider's own token endpoint stands in for.
 * The other two would hand a signed-in browser its GitHub access token:
 * nothing of Luke's reads that token anywhere but on the server
 * (`github/github-app.ts`), and root AGENTS.md pins that no credential
 * travels in an answer, so neither door is open.
 *
 * Every organization write a browser could reach is shut as well. A
 * workspace's slug is what a later sync adopts a workspace by, so a session
 * free to create an organization, or to rename its own, could take a slug
 * before the team it belongs to arrives and be adopted in its place.
 * Workspaces and their members are written only by Luke's server, through
 * the server-only `auth.api` calls, which these paths do not reach. The
 * invitation endpoints are shut for a second reason: Luke sends no
 * invitation mail, and the plugin would otherwise write an invitation row
 * nobody is told about. The team and role endpoints are listed although
 * this deployment does not mount them, so turning either option on later
 * opens no door by itself.
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
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/get-invitation",
  "/organization/list-invitations",
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
] as const;

/**
 * How Better Auth keeps workspaces, each an organization of its members. A
 * workspace is never deleted, so no plan is lost with one, and no signed-in
 * user creates one: the plugin still lets a server-only call that names a
 * `userId` and carries no session through, which is the one way Luke
 * creates a workspace.
 */
export const ORGANIZATION_OPTIONS = {
  allowUserToCreateOrganization: false,
  disableOrganizationDeletion: true,
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
