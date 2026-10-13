/**
 * auth-policy.ts -- the auth policy constants, apart from the `betterAuth` construction that reads them.
 *
 * `auth.ts` cannot be imported without a database, and what this deployment
 * fixes about sign-in, token storage, key storage, and client privileges is
 * worth asserting without one.
 */

import type { BetterAuthOptions } from "better-auth";

/** The social provider ids Better Auth routes a callback by (`/callback/:id`). */
const SOCIAL_PROVIDER_ID = {
  GITHUB: "github",
} as const;

type UserUpdateHooks = NonNullable<
  NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>["update"]
>;
type UserUpdateBefore = NonNullable<UserUpdateHooks["before"]>;

/**
 * What a GitHub sign-in asks for. It is the Luke GitHub App's user
 * authorization, and a GitHub App has permissions rather than scopes: what
 * the token reaches is fixed by the App's registration (repository metadata,
 * contents, and pull requests where the App is installed and the user has
 * access, and the user's email addresses), so the request names no OAuth
 * scope, and Better Auth's own `read:user user:email` default is switched off
 * rather than sent for GitHub to ignore.
 *
 * Every sign-in also refreshes the user's name and picture from GitHub. Note
 * that we do so because an account first made with Google, before sign-in was
 * GitHub's alone, still holds a Google picture URL, which the desktop's image
 * policy (GitHub's avatar host alone) drops; GitHub's own avatar replaces it.
 * Better Auth's refresh writes the email too, which `USER_PROFILE_HOOKS`
 * below takes back out.
 */
export const GITHUB_SIGN_IN = {
  disableDefaultScope: true,
  overrideUserInfoOnSignIn: true,
} as const;

/**
 * Keeps a GitHub sign-in's profile refresh to name and picture. Better Auth's
 * `overrideUserInfoOnSignIn` writes GitHub's primary email over the user's
 * along with them, and that is refused here: the email is the identity people
 * know the account by, and `user.email` is unique, so a GitHub primary email
 * another account already holds would fail the update and with it the
 * sign-in. The refresh is the one update in a GitHub callback that carries an
 * email; the sign-in's other update, marking an email verified as an account
 * is linked, carries none and passes untouched. The hook is the documented
 * `databaseHooks.user.update.before`
 * (https://www.better-auth.com/docs/concepts/database#database-hooks). Note
 * that the email is answered as `undefined` rather than left out, because
 * 1.6.29 spreads a hook's data over the update rather than replacing it as
 * the docs say, and its adapter factory writes no field an update holds as
 * `undefined`.
 */
const keepEmailThroughGitHubSignIn: UserUpdateBefore = async (user, context) => {
  if (context?.params?.id !== SOCIAL_PROVIDER_ID.GITHUB || user.email === undefined) return;
  return { data: { ...user, email: undefined, emailVerified: undefined } };
};

export const USER_PROFILE_HOOKS = {
  user: { update: { before: keepEmailThroughGitHubSignIn } },
} as const satisfies BetterAuthOptions["databaseHooks"];

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
 * travels in an answer, so neither door is open. The organization plugin's
 * invitation endpoints are shut too: Luke sends no invitation mail, and the
 * plugin would otherwise write an invitation row nobody is told about. An
 * owner adds an existing account to a workspace instead.
 */
export const DISABLED_AUTH_PATHS = [
  "/token",
  "/get-access-token",
  "/refresh-token",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/get-invitation",
  "/organization/list-invitations",
  "/organization/list-user-invitations",
] as const;

/**
 * How Better Auth keeps workspaces, each an organization of its members. A
 * workspace is never deleted, so no plan is lost with one.
 */
export const ORGANIZATION_OPTIONS = {
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
