import { and, desc, eq, exists, inArray, max, min, not, notInArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../schemas/auth.js";
import { InstantColumnSchema } from "./columns.js";

export interface OAuthGrant {
  readonly clientId: string;
  readonly name: string | null;
  readonly redirectUris: readonly string[];
  readonly allowedAt: Date | null;
  readonly lastRefreshedAt: Date | null;
}

const ConsentedClientSchema = Schema.Struct({
  clientId: Schema.String,
  name: Schema.NullOr(Schema.String),
  redirectUris: Schema.Array(Schema.String),
  allowedAt: Schema.NullOr(InstantColumnSchema),
});

const findConsentedClients = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, except: Schema.Array(Schema.String) }),
  Result: ConsentedClientSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          clientId: oauthConsent.clientId,
          name: oauthClient.name,
          redirectUris: oauthClient.redirectUris,
          allowedAt: oauthConsent.createdAt,
        })
        .from(oauthConsent)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
        .where(
          and(
            eq(oauthConsent.userId, key.userId),
            key.except.length === 0
              ? undefined
              : notInArray(oauthConsent.clientId, [...key.except]),
          ),
        )
        .orderBy(desc(oauthConsent.createdAt)),
    ),
});

const findTokenOnlyClients = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, clients: Schema.Array(Schema.String) }),
  Result: ConsentedClientSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          clientId: oauthClient.clientId,
          name: oauthClient.name,
          redirectUris: oauthClient.redirectUris,
          allowedAt: min(oauthRefreshToken.createdAt),
        })
        .from(oauthRefreshToken)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthRefreshToken.clientId))
        .where(
          and(
            eq(oauthRefreshToken.userId, key.userId),
            inArray(oauthRefreshToken.clientId, [...key.clients]),
            not(
              exists(
                db
                  .select({ id: oauthConsent.id })
                  .from(oauthConsent)
                  .where(
                    and(
                      eq(oauthConsent.userId, key.userId),
                      eq(oauthConsent.clientId, oauthRefreshToken.clientId),
                    ),
                  ),
              ),
            ),
          ),
        )
        .groupBy(oauthClient.id)
        .having(sql`bool_or(${oauthRefreshToken.revoked} is null)`),
    ),
});

const findLastRefreshes = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    clientId: Schema.String,
    lastRefreshedAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          clientId: oauthRefreshToken.clientId,
          lastRefreshedAt: max(oauthRefreshToken.rotatedAt),
        })
        .from(oauthRefreshToken)
        .where(eq(oauthRefreshToken.userId, userId))
        .groupBy(oauthRefreshToken.clientId),
    ),
});

const ClientTokensSchema = Schema.Struct({ userId: Schema.String, clientId: Schema.String });

const deleteAccessTokens = SqlSchema.void({
  Request: ClientTokensSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(oauthAccessToken)
        .where(
          and(eq(oauthAccessToken.userId, key.userId), eq(oauthAccessToken.clientId, key.clientId)),
        ),
    ),
});

const deleteRefreshTokens = SqlSchema.void({
  Request: ClientTokensSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(oauthRefreshToken)
        .where(
          and(
            eq(oauthRefreshToken.userId, key.userId),
            eq(oauthRefreshToken.clientId, key.clientId),
          ),
        ),
    ),
});

export function listOAuthGrants(
  userId: string,
  clients: { readonly except: readonly string[]; readonly tokenOnly: readonly string[] },
): Effect.Effect<readonly OAuthGrant[], StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const consented = yield* findConsentedClients({ userId, except: clients.except });
    const tokenOnly = yield* findTokenOnlyClients({ userId, clients: clients.tokenOnly });
    const refreshes = yield* findLastRefreshes(userId);
    const refreshedAt = new Map(refreshes.map((each) => [each.clientId, each.lastRefreshedAt]));
    return [...consented, ...tokenOnly]
      .toSorted((a, b) => (b.allowedAt?.getTime() ?? 0) - (a.allowedAt?.getTime() ?? 0))
      .map((each) => ({ ...each, lastRefreshedAt: refreshedAt.get(each.clientId) ?? null }));
  });
}

export function revokeOAuthClientTokens(
  userId: string,
  clientId: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* deleteAccessTokens({ userId, clientId });
        yield* deleteRefreshTokens({ userId, clientId });
      }),
    ),
  );
}
