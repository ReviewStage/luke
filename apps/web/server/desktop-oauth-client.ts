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

export function desktopOAuthClientRecord(now: Date) {
  return {
    id: DESKTOP_OAUTH_CLIENT.id,
    clientId: DESKTOP_OAUTH_CLIENT.id,
    disabled: false,
    skipConsent: true,
    enableEndSession: false,
    scopes: [...DESKTOP_OAUTH_CLIENT.scopes],
    createdAt: now,
    updatedAt: now,
    name: DESKTOP_OAUTH_CLIENT.name,
    redirectUris: [...DESKTOP_OAUTH_CLIENT.redirectUris],
    tokenEndpointAuthMethod: DESKTOP_OAUTH_CLIENT.tokenEndpointAuthMethod,
    grantTypes: [...DESKTOP_OAUTH_CLIENT.grantTypes],
    responseTypes: [...DESKTOP_OAUTH_CLIENT.responseTypes],
    public: true,
    type: DESKTOP_OAUTH_CLIENT.type,
    requirePKCE: true,
  };
}
