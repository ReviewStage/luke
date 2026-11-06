import { pathToFileURL } from "node:url";
import { Database, type DatabaseServices, type QueryError } from "@repo/database/core/query";
import {
  jwks as jwksTable,
  oauthClient as oauthClientTable,
  oauthResource as oauthResourceTable,
} from "@repo/database/schemas/auth";
import { authDeployment, authSecrets } from "@repo/service/auth/auth-deployment";
import {
  CLI_OAUTH_CLIENT,
  DESKTOP_OAUTH_CLIENT,
  type OAuthClient,
  oauthClientRecord,
} from "@repo/service/auth/oauth-clients";
import { oauthResourceRecord } from "@repo/service/member-mcp/resource";
import { symmetricDecrypt } from "better-auth/crypto";
import { inArray } from "drizzle-orm";
import { Effect, Redacted } from "effect";
import { disposeWebRuntime, runWeb } from "./runtime.js";

function seedOAuthClient(client: OAuthClient): Effect.Effect<void, QueryError, DatabaseServices> {
  const record = oauthClientRecord(client, new Date());
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
    Database.use((db) =>
      db
        .insert(oauthClientTable)
        .values({ id: record.id, createdAt: record.createdAt, ...written })
        .onConflictDoUpdate({ target: oauthClientTable.clientId, set: written }),
    ),
  );
}

function seedOAuthResource(baseURL: string): Effect.Effect<void, QueryError, DatabaseServices> {
  const record = oauthResourceRecord(baseURL, new Date());
  const written = {
    name: record.name,
    accessTokenTtl: record.accessTokenTtl,
    refreshTokenTtl: record.refreshTokenTtl,
    allowedScopes: [...record.allowedScopes],
    dpopBoundAccessTokensRequired: record.dpopBoundAccessTokensRequired,
    disabled: record.disabled,
    policyVersion: record.policyVersion,
    updatedAt: record.updatedAt,
  };
  return Effect.asVoid(
    Database.use((db) =>
      db
        .insert(oauthResourceTable)
        .values({
          id: record.id,
          identifier: record.identifier,
          createdAt: record.createdAt,
          ...written,
        })
        .onConflictDoUpdate({ target: oauthResourceTable.identifier, set: written }),
    ),
  );
}

function opensUnder(sessionSecret: Redacted.Redacted, privateKey: string): Effect.Effect<boolean> {
  return Effect.tryPromise(async () => {
    await symmetricDecrypt({ key: Redacted.value(sessionSecret), data: JSON.parse(privateKey) });
    return true;
  }).pipe(Effect.orElseSucceed(() => false));
}

export function dropUnreadableJwks(
  sessionSecret: Redacted.Redacted,
): Effect.Effect<void, QueryError, DatabaseServices> {
  return Effect.gen(function* () {
    const db = yield* Database;
    const keys = yield* db
      .select({ id: jwksTable.id, privateKey: jwksTable.privateKey })
      .from(jwksTable);
    const unreadable: string[] = [];
    for (const key of keys) {
      if (!(yield* opensUnder(sessionSecret, key.privateKey))) unreadable.push(key.id);
    }
    if (unreadable.length === 0) return;
    yield* db.delete(jwksTable).where(inArray(jwksTable.id, unreadable));
  });
}

function seedDeployment(
  variables: Record<string, string | undefined>,
): Effect.Effect<void, QueryError, DatabaseServices> {
  const { sessionSecret } = authSecrets(variables);
  return Effect.all(
    [
      seedOAuthClient(DESKTOP_OAUTH_CLIENT),
      seedOAuthClient(CLI_OAUTH_CLIENT),
      seedOAuthResource(authDeployment(variables).baseURL),
      sessionSecret === undefined ? Effect.void : dropUnreadableJwks(sessionSecret),
    ],
    { discard: true },
  );
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await runWeb(seedDeployment(process.env));
  await disposeWebRuntime();
}
