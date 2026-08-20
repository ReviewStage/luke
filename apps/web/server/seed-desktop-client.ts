import { pathToFileURL } from "node:url";
import { oauthClient } from "./db/auth-schema.js";
import { getDatabase } from "./db/index.js";
import { desktopOAuthClientRecord } from "./desktop-oauth-client.js";

type SeedDatabase = Pick<ReturnType<typeof getDatabase>, "insert">;

export async function seedDesktopOAuthClient(
  database: SeedDatabase,
  now = new Date(),
): Promise<void> {
  const record = desktopOAuthClientRecord(now);
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

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await seedDesktopOAuthClient(getDatabase());
}
