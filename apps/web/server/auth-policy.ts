/**
 * auth-policy.ts -- the auth policy constants, apart from the `betterAuth` construction that reads them.
 *
 * `auth.ts` cannot be imported without a database, and what this deployment
 * fixes about sign-in, token storage, key storage, and client privileges is
 * worth asserting without one.
 */

import {
  isPersonalWorkspaceMetadata,
  type StoredOrganizationMetadata,
} from "@sidecar/database/models/workspace-seams";
import { APIError } from "better-auth/api";

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
 * workspaces are created and their members removed only by Luke's server,
 * through the server-only `auth.api` calls, which these paths do not reach.
 *
 * A teammate joins by invitation, Better Auth's own
 * (https://www.better-auth.com/docs/plugins/organization#invitations): the
 * invite page asks for one, lists and cancels the pending ones, and the
 * invitee's page reads and accepts theirs, so exactly those five endpoints
 * are served (`invite-member`, `list-invitations`, `cancel-invitation`,
 * `get-invitation`, `accept-invitation`). The plugin checks each against the
 * caller's role and address itself. Rejecting and listing one's own
 * invitations stay shut, since no page of Luke's asks for either. The team
 * and role endpoints are listed although this deployment does not mount
 * them, so turning either option on later opens no door by itself.
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
] as const;

/** Why the plugin refused an invitation on Luke's own terms, apart from its own refusals. */
export const INVITATION_REFUSAL = {
  PERSONAL_WORKSPACE: "PERSONAL_WORKSPACE_TAKES_NO_INVITATIONS",
} as const;

/**
 * Refuses an invitation into a personal workspace, which is its account's
 * alone. The plugin's `beforeCreateInvitation` hook is the documented place
 * to stop one (https://www.better-auth.com/docs/plugins/organization#organization-hooks),
 * and it is handed the organization, whose metadata only Luke's server
 * writes, since organization updates are shut.
 */
async function refusePersonalInvitation(data: {
  organization: { metadata?: StoredOrganizationMetadata };
}) {
  if (!isPersonalWorkspaceMetadata(data.organization.metadata)) return;
  throw new APIError("FORBIDDEN", {
    code: INVITATION_REFUSAL.PERSONAL_WORKSPACE,
    message: "A personal workspace is yours alone, so it takes no invitations.",
  });
}

/**
 * How Better Auth keeps workspaces, each an organization of its members. A
 * workspace is never deleted, so no plan is lost with one, and no signed-in
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
  organizationHooks: { beforeCreateInvitation: refusePersonalInvitation },
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
