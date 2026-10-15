/**
 * Luke's own native client, and the record shape it is provisioned under: a
 * public PKCE client with no secret.
 */

export const DESKTOP_OAUTH_CLIENT = {
  id: "luke-desktop",
  name: "Luke for macOS",
  scopes: ["openid", "profile", "email", "offline_access"],
  redirectUris: ["http://127.0.0.1/callback"],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  type: "native",
} as const;

export type OAuthClient = typeof DESKTOP_OAUTH_CLIENT;

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
