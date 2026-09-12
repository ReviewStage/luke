import { pathToFileURL } from "node:url";
import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect } from "effect";
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
  return Effect.asVoid(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        insert into oauth_client (
          id, client_id, disabled, skip_consent, enable_end_session, scopes,
          created_at, updated_at, name, redirect_uris, token_endpoint_auth_method,
          grant_types, response_types, public, type, require_pkce
        )
        values (
          ${record.id}, ${record.clientId}, ${record.disabled}, ${record.skipConsent},
          ${record.enableEndSession}, ${[...record.scopes]}, ${record.createdAt},
          ${record.updatedAt}, ${record.name}, ${[...record.redirectUris]},
          ${record.tokenEndpointAuthMethod}, ${[...record.grantTypes]},
          ${[...record.responseTypes]}, ${record.public}, ${record.type}, ${record.requirePKCE}
        )
        on conflict (client_id) do update set
          disabled = excluded.disabled,
          skip_consent = excluded.skip_consent,
          enable_end_session = excluded.enable_end_session,
          scopes = excluded.scopes,
          updated_at = excluded.updated_at,
          name = excluded.name,
          redirect_uris = excluded.redirect_uris,
          token_endpoint_auth_method = excluded.token_endpoint_auth_method,
          grant_types = excluded.grant_types,
          response_types = excluded.response_types,
          public = excluded.public,
          type = excluded.type,
          require_pkce = excluded.require_pkce
      `,
    ),
  );
}

export function seedOAuthClients(
  now = new Date(),
): Effect.Effect<void, SqlError, SqlClient.SqlClient> {
  return Effect.zipRight(
    seedOAuthClient(DESKTOP_OAUTH_CLIENT, now),
    seedOAuthClient(MOBILE_OAUTH_CLIENT, now),
  );
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await runWeb(seedOAuthClients());
  await disposeWebRuntime();
}
