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

export function mobileOAuthClientRecord(now: Date) {
  return {
    id: MOBILE_OAUTH_CLIENT.id,
    clientId: MOBILE_OAUTH_CLIENT.id,
    disabled: false,
    skipConsent: true,
    enableEndSession: false,
    scopes: [...MOBILE_OAUTH_CLIENT.scopes],
    createdAt: now,
    updatedAt: now,
    name: MOBILE_OAUTH_CLIENT.name,
    redirectUris: [...MOBILE_OAUTH_CLIENT.redirectUris],
    tokenEndpointAuthMethod: MOBILE_OAUTH_CLIENT.tokenEndpointAuthMethod,
    grantTypes: [...MOBILE_OAUTH_CLIENT.grantTypes],
    responseTypes: [...MOBILE_OAUTH_CLIENT.responseTypes],
    public: true,
    type: MOBILE_OAUTH_CLIENT.type,
    requirePKCE: true,
  };
}
