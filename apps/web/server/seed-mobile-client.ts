import { oauthClient } from "./db/auth-schema.js";
import type { getDatabase } from "./db/index.js";
import { mobileOAuthClientRecord } from "./mobile-oauth-client.js";

type SeedDatabase = Pick<ReturnType<typeof getDatabase>, "insert">;

export async function seedMobileOAuthClient(
  database: SeedDatabase,
  now = new Date(),
): Promise<void> {
  const record = mobileOAuthClientRecord(now);
  await database
    .insert(oauthClient)
    .values(record)
    .onConflictDoUpdate({
      target: oauthClient.clientId,
      set: {
        disabled: record.disabled,
        skipConsent: record.skipConsent,
        enableEndSession: record.enableEndSession,
        scopes: record.scopes,
        updatedAt: record.updatedAt,
        name: record.name,
        redirectUris: record.redirectUris,
        tokenEndpointAuthMethod: record.tokenEndpointAuthMethod,
        grantTypes: record.grantTypes,
        responseTypes: record.responseTypes,
        public: record.public,
        type: record.type,
        requirePKCE: record.requirePKCE,
      },
    });
}
