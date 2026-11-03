import { PRODUCT_NAME } from "@repo/features/product-name";

/**
 * Our own native client, and the record shape it is provisioned under: a
 * public PKCE client with no secret.
 */

/** A client as this build provisions one: public, with no secret, under the scopes and redirects it names. */
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
  id: "desktop",
  name: `${PRODUCT_NAME} for macOS`,
  scopes: ["openid", "profile", "email", "offline_access"],
  redirectUris: ["http://127.0.0.1/callback"],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  type: "native",
} as const satisfies OAuthClient;

/** One `oauth_client` row, camelCase as the auth service's own Kysely adapter reads and writes it. */
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

/** One client's row as the seeder writes it: enabled, public, consent skipped, PKCE required. */
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
