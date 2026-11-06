import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { PRODUCT_NAME } from "@repo/features/product-name";

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly redirectUris: readonly string[];
  readonly tokenEndpointAuthMethod: string;
  readonly grantTypes: readonly string[];
  readonly responseTypes: readonly string[];
  readonly type: string;
}

export const DESKTOP_OAUTH_CLIENT = {
  id: FIRST_PARTY_OAUTH_CLIENT_ID.DESKTOP,
  name: `${PRODUCT_NAME} for macOS`,
  scopes: ["openid", "profile", "email", "offline_access"],
  redirectUris: ["http://127.0.0.1/callback"],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  type: "native",
} as const satisfies OAuthClient;

export const CLI_OAUTH_CLIENT = {
  id: FIRST_PARTY_OAUTH_CLIENT_ID.CLI,
  name: `${PRODUCT_NAME} CLI`,
  scopes: ["openid", "profile", "email", "offline_access"],
  redirectUris: ["http://127.0.0.1/callback"],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  type: "native",
} as const satisfies OAuthClient;

interface OAuthClientRecord {
  readonly id: string;
  readonly clientId: string;
  readonly disabled: boolean;
  readonly skipConsent: boolean;
  readonly enableEndSession: boolean;
  readonly scopes: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly tokenEndpointAuthMethod: string;
  readonly grantTypes: readonly string[];
  readonly responseTypes: readonly string[];
  readonly public: boolean;
  readonly type: string;
  readonly requirePKCE: boolean;
}

export function oauthClientRecord(client: OAuthClient, now: Date): OAuthClientRecord {
  return {
    id: client.id,
    clientId: client.id,
    disabled: false,
    skipConsent: true,
    enableEndSession: false,
    scopes: [...client.scopes],
    createdAt: now,
    updatedAt: now,
    name: client.name,
    redirectUris: [...client.redirectUris],
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    grantTypes: [...client.grantTypes],
    responseTypes: [...client.responseTypes],
    public: true,
    type: client.type,
    requirePKCE: true,
  };
}
