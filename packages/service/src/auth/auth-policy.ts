import type { CimdOptions } from "@better-auth/cimd";
import type { ClientMetadataResourceFetch, OAuthOptions, Scope } from "@better-auth/oauth-provider";
import { DESKTOP_SESSION_CLIENT_ID } from "@repo/features/desktop-session-wire";
import type { AdminOptions } from "better-auth/plugins";
import { USER_ROLE } from "../admin/admin-access.js";
import { MEMBER_MCP_SCOPE } from "../member-mcp/resource.js";

export const LOGIN_PAGE = "/sign-in";

export const AUTH_BASE_PATH = "/api/auth";

export const OAUTH_PROVIDER_SCOPES = [
  "openid",
  "profile",
  "email",
  MEMBER_MCP_SCOPE.OFFLINE_ACCESS,
  MEMBER_MCP_SCOPE.MCP,
] as const;

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

const MCP_METADATA_PROFILE = "mcp-2026-07-28" as const satisfies CimdOptions["metadataProfile"];

export function memberMcpClientDiscovery(
  fetchClientMetadataResource: ClientMetadataResourceFetch,
): CimdOptions {
  return { fetchClientMetadataResource, metadataProfile: MCP_METADATA_PROFILE };
}

export const AUTH_RATE_LIMIT = { enabled: true, storage: "database" } as const;

export const CLIENT_ADDRESS_HEADERS = ["x-real-ip", "x-forwarded-for"] as const;

export const GITHUB_SIGN_IN = {
  disableDefaultScope: true,
} as const;

export const ACCOUNT_TOKEN_STORAGE = {
  encryptOAuthTokens: true,
  updateAccountOnSignIn: true,
  accountLinking: { enabled: true, allowDifferentEmails: true },
} as const;

export const SUPPORT_ACCESS_PATH = {
  GRANT: "/support-access/grant",
  REVOKE: "/support-access/revoke",
} as const;

export const SUPPORT_ACCESS_GRANT_SECONDS = 7 * 24 * 60 * 60;

export function standingSupportAccess(until: Date | null | undefined, now: number): number | null {
  const end = until?.getTime();
  return end !== undefined && end > now ? end : null;
}

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
  "/admin/set-role",
  "/admin/get-user",
  "/admin/create-user",
  "/admin/update-user",
  "/admin/list-users",
  "/admin/list-user-sessions",
  "/admin/unban-user",
  "/admin/ban-user",
  "/admin/revoke-user-session",
  "/admin/revoke-user-sessions",
  "/admin/remove-user",
  "/admin/set-user-password",
  "/admin/has-permission",
  SUPPORT_ACCESS_PATH.GRANT,
  SUPPORT_ACCESS_PATH.REVOKE,
] as const;

export const SESSION_BEARER = { requireSignature: true } as const;

export const SESSION_COOKIE_CACHE = {
  cookieCache: { enabled: true, maxAge: 60, strategy: "jwe" },
} as const;

export const ADMIN_OPTIONS = {
  adminRoles: [USER_ROLE.ADMIN],
  defaultRole: USER_ROLE.USER,
  impersonationSessionDuration: 60 * 60,
} satisfies AdminOptions;

export const DESKTOP_SESSION = { clientID: DESKTOP_SESSION_CLIENT_ID } as const;

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

export function denyOAuthClientPrivileges(): false {
  return false;
}

export function denyOAuthResourcePrivileges(): false {
  return false;
}
