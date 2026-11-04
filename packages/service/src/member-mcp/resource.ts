/**
 * resource.ts -- the member MCP server as the OAuth resource it is: its address under a deployment, the scope a token for it needs, and the token policy the auth service mints under.
 *
 * An outside MCP client acts for a member on an access token the auth
 * service minted for this resource alone: the client names the resource as
 * it authorizes (RFC 8707), and the token's `aud` names it back, carrying
 * `vespin:mcp`. Every address here is the deployment's own base URL's, so a
 * Preview is its own resource and its own issuer. The policy is the
 * provider's resource row (`oauth_resource`), which the deployment's seeder
 * writes from `oauthResourceRecord` at every build
 * (`apps/web/server/seed-clients.ts`), as it writes the desktop client's,
 * and which the provider reads as it mints: an access token lives fifteen
 * minutes, since a token verified against the key set alone does not see
 * its revocation; a refresh token lapses after thirty days unused, each
 * refresh minting one with a window of its own. Note that the row is not
 * the provider's own `resources` option, whose seed queries the store as
 * the auth service loads, which every function bundle must do with nothing
 * configured.
 */

import type { OAuthResourceInput } from "@better-auth/oauth-provider";
import { MCP_ACCESS_TOKEN_MINUTES } from "@repo/features/mcp-client-wire";
import { OAUTH_SCOPE } from "@repo/features/oauth-consent";
import { PRODUCT_NAME } from "@repo/features/product-name";

/** The path the server answers under the deployment's base URL, which is also the resource's identifier there. */
export const MEMBER_MCP_PATH = "/api/mcp";

/** The scopes a token for the server may carry: ours, which every call needs, and OAuth's own for a refresh token; never `openid`, which only the auth service answers. The spellings are the consent page's (`@repo/features/oauth-consent`), which says each in the member's words. */
export const MEMBER_MCP_SCOPE = {
  MCP: OAUTH_SCOPE.MCP,
  OFFLINE_ACCESS: OAUTH_SCOPE.OFFLINE_ACCESS,
} as const;

/** How long a token for the server lives, in seconds; an access token as long as Settings tells a member a revoked client keeps one (`@repo/features/mcp-client-wire`). */
export const MEMBER_MCP_TOKEN_TTL = {
  ACCESS: MCP_ACCESS_TOKEN_MINUTES * 60,
  REFRESH: 30 * 24 * 60 * 60,
} as const;

/** The resource's identifier under a deployment: the server's own address. */
export function memberMcpResourceUrl(baseURL: string): string {
  return `${baseURL}${MEMBER_MCP_PATH}`;
}

/** The resource's policy, as the provider's own `OAuthResourceInput` states one. */
export function memberMcpResource(baseURL: string): OAuthResourceInput {
  return {
    identifier: memberMcpResourceUrl(baseURL),
    name: `${PRODUCT_NAME} MCP`,
    accessTokenTtl: MEMBER_MCP_TOKEN_TTL.ACCESS,
    refreshTokenTtl: MEMBER_MCP_TOKEN_TTL.REFRESH,
    allowedScopes: Object.values(MEMBER_MCP_SCOPE),
  };
}

/** One `oauth_resource` row, camelCase as the auth service's adapter reads and writes it: what the plugin's own seed would write for the policy. */
export interface OAuthResourceRecord {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
  readonly accessTokenTtl: number;
  readonly refreshTokenTtl: number;
  readonly allowedScopes: readonly string[];
  readonly dpopBoundAccessTokensRequired: boolean;
  readonly disabled: boolean;
  readonly policyVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The resource's row as the seeder writes it under a deployment: enabled, with the policy above, keyed by its identifier. */
export function oauthResourceRecord(baseURL: string, now: Date): OAuthResourceRecord {
  const resource = memberMcpResource(baseURL);
  return {
    id: resource.identifier,
    identifier: resource.identifier,
    name: resource.name ?? resource.identifier,
    accessTokenTtl: MEMBER_MCP_TOKEN_TTL.ACCESS,
    refreshTokenTtl: MEMBER_MCP_TOKEN_TTL.REFRESH,
    allowedScopes: Object.values(MEMBER_MCP_SCOPE),
    dpopBoundAccessTokensRequired: false,
    disabled: false,
    policyVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}
