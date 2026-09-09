import type { oauthClient } from "./db/auth-schema.js";

/**
 * Luke's own native clients, and the one record shape they are provisioned
 * under. Both are public PKCE clients with no secret: the same terms, so the
 * record is written once and each client differs only in its id, its name,
 * and where its redirect lands.
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

export const MOBILE_OAUTH_CLIENT = {
  id: "luke-mobile",
  name: "Luke for iOS",
  scopes: ["openid", "profile", "email", "offline_access"],
  redirectUris: ["dev.tryluke.ios://oauth/callback"],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  type: "native",
} as const;

export type OAuthClient = typeof DESKTOP_OAUTH_CLIENT | typeof MOBILE_OAUTH_CLIENT;

/** One client's row as the seeder writes it: enabled, public, consent skipped, PKCE required. */
export function oauthClientRecord(client: OAuthClient, now: Date): typeof oauthClient.$inferInsert {
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
