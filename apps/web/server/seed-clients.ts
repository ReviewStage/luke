import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { oauthClient as oauthClientTable } from "./db/auth-schema.js";
import { db } from "./db/query.js";
import {
  DESKTOP_OAUTH_CLIENT,
  MOBILE_OAUTH_CLIENT,
  type OAuthClient,
  oauthClientRecord,
} from "./oauth-clients.js";
import { disposeWebRuntime, runWeb } from "./runtime.js";

/**
 * Writes one client's row, or brings an existing one back to what this build
 * says it is. Every field but the id and the creation instant is set on
 * conflict, so a row edited by hand converges rather than standing.
 */
export function seedOAuthClient(
  client: OAuthClient,
  now = new Date(),
): Effect.Effect<void, SqlError, SqlClient.SqlClient> {
  const record = oauthClientRecord(client, now);
  // Note that the conflicting update sets the values the insert carried
  // rather than reading them back out of `excluded`, because a single-row
  // insert's `excluded` row is exactly those values and naming the columns in
  // SQL text is what a renamed column would slip through. The id and the
  // creation instant are the two the insert carries and the update leaves.
  const written = {
    clientId: record.clientId,
    disabled: record.disabled,
    skipConsent: record.skipConsent,
    enableEndSession: record.enableEndSession,
    scopes: [...record.scopes],
    updatedAt: record.updatedAt,
    name: record.name,
    redirectUris: [...record.redirectUris],
    tokenEndpointAuthMethod: record.tokenEndpointAuthMethod,
    grantTypes: [...record.grantTypes],
    responseTypes: [...record.responseTypes],
    public: record.public,
    type: record.type,
    requirePKCE: record.requirePKCE,
  };
  return Effect.asVoid(
    db
      .insert(oauthClientTable)
      .values({ id: record.id, createdAt: record.createdAt, ...written })
      .onConflictDoUpdate({ target: oauthClientTable.clientId, set: written }),
  );
}

function seedOAuthClients(now = new Date()): Effect.Effect<void, SqlError, SqlClient.SqlClient> {
  return Effect.andThen(
    seedOAuthClient(DESKTOP_OAUTH_CLIENT, now),
    seedOAuthClient(MOBILE_OAUTH_CLIENT, now),
  );
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await runWeb(seedOAuthClients());
  await disposeWebRuntime();
}
