import { pathToFileURL } from "node:url";
import { oauthClient } from "./db/auth-schema.js";
import { getDatabase } from "./db/index.js";
import {
  DESKTOP_OAUTH_CLIENT,
  MOBILE_OAUTH_CLIENT,
  type OAuthClient,
  oauthClientRecord,
} from "./oauth-clients.js";

type SeedDatabase = Pick<ReturnType<typeof getDatabase>, "insert">;

/**
 * Writes one client's row, or brings an existing one back to what this build
 * says it is. Every field but the id and the creation instant is set on
 * conflict, so a row edited by hand converges rather than standing.
 */
export async function seedOAuthClient(
  database: SeedDatabase,
  client: OAuthClient,
  now = new Date(),
): Promise<void> {
  const record = oauthClientRecord(client, now);
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

export async function seedOAuthClients(database: SeedDatabase, now = new Date()): Promise<void> {
  await seedOAuthClient(database, DESKTOP_OAUTH_CLIENT, now);
  await seedOAuthClient(database, MOBILE_OAUTH_CLIENT, now);
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await seedOAuthClients(getDatabase());
}
