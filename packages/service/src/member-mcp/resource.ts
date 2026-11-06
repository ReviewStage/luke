import type { OAuthResourceInput } from "@better-auth/oauth-provider";
import { MCP_ACCESS_TOKEN_MINUTES } from "@repo/features/mcp-client-wire";
import { MCP_SERVER_PATH } from "@repo/features/mcp-connect";
import { OAUTH_SCOPE } from "@repo/features/oauth-consent";
import { PRODUCT_NAME } from "@repo/features/product-name";

export const MEMBER_MCP_PATH = MCP_SERVER_PATH;

export const MEMBER_MCP_SCOPE = {
  MCP: OAUTH_SCOPE.MCP,
  OFFLINE_ACCESS: OAUTH_SCOPE.OFFLINE_ACCESS,
} as const;

export const MEMBER_MCP_TOKEN_TTL = {
  ACCESS: MCP_ACCESS_TOKEN_MINUTES * 60,
  REFRESH: 30 * 24 * 60 * 60,
} as const;

export function memberMcpResourceUrl(baseURL: string): string {
  return `${baseURL}${MEMBER_MCP_PATH}`;
}

export function memberMcpResource(baseURL: string): OAuthResourceInput {
  return {
    identifier: memberMcpResourceUrl(baseURL),
    name: `${PRODUCT_NAME} MCP`,
    accessTokenTtl: MEMBER_MCP_TOKEN_TTL.ACCESS,
    refreshTokenTtl: MEMBER_MCP_TOKEN_TTL.REFRESH,
    allowedScopes: Object.values(MEMBER_MCP_SCOPE),
  };
}

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
