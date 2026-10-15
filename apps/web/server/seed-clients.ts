import { pathToFileURL } from "node:url";
import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { jwks as jwksTable, oauthClient as oauthClientTable } from "@luke/database/schemas/auth";
import { authSecrets } from "@luke/service/auth/auth-deployment";
import {
  DESKTOP_OAUTH_CLIENT,
  type OAuthClient,
  oauthClientRecord,
} from "@luke/service/auth/oauth-clients";
import { symmetricDecrypt } from "better-auth/crypto";
import { inArray } from "drizzle-orm";
import { Effect, Redacted } from "effect";
import { disposeWebRuntime, runWeb } from "./runtime.js";

/**
 * Writes one client's row, or brings an existing one back to what this build
 * says it is. Every field but the id and the creation instant is set on
 * conflict, so a row edited by hand converges rather than standing.
 */
export function seedOAuthClient(
  client: OAuthClient,
  now = new Date(),
): Effect.Effect<void, QueryError, DatabaseServices> {
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
    Database.use((db) =>
      db
        .insert(oauthClientTable)
        .values({ id: record.id, createdAt: record.createdAt, ...written })
        .onConflictDoUpdate({ target: oauthClientTable.clientId, set: written }),
    ),
  );
}

/** Whether this deployment's secret opens one sealed private key; a key sealed under another secret does not parse or does not decrypt. */
function opensUnder(sessionSecret: Redacted.Redacted, privateKey: string): Effect.Effect<boolean> {
  return Effect.tryPromise(async () => {
    await symmetricDecrypt({ key: Redacted.value(sessionSecret), data: JSON.parse(privateKey) });
    return true;
  }).pipe(Effect.orElseSucceed(() => false));
}

/**
 * Deletes every signing key this deployment cannot open. Better Auth seals a
 * JWKS private key under the secret of the deployment that minted it and, at
 * the token endpoint, fails the whole exchange when the latest key will not
 * open, after the tokens are already written, so a sign-in against such a
 * key ends with the desktop refused and tokens nobody holds. A Preview's
 * database is a branch of production's, so it arrives carrying production's
 * key under a secret a Preview by design never holds (`AuthDeployment`'s
 * proxy secret is the only one the two share), and every desktop sign-in
 * against the Preview would end there. A key that will not open here can
 * sign nothing here, so it goes, and Better Auth mints one under the secret
 * it has at the next signature. A key that opens is left standing, so
 * production, whose secret sealed its own key, deletes nothing.
 */
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

/** What every deployment build seeds: the desktop client, and then a key set this deployment can sign with. */
function seedDeployment(
  variables: Record<string, string | undefined>,
): Effect.Effect<void, QueryError, DatabaseServices> {
  const { sessionSecret } = authSecrets(variables);
  // Note that a build without a session secret drops nothing, because the
  // deployment it builds signs nothing, and `auth.ts` says so as it loads.
  return Effect.andThen(
    seedOAuthClient(DESKTOP_OAUTH_CLIENT),
    sessionSecret === undefined ? Effect.void : dropUnreadableJwks(sessionSecret),
  );
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await runWeb(seedDeployment(process.env));
  await disposeWebRuntime();
}
