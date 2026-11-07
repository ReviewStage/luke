import { and, desc, eq, exists, inArray, max, min, not, notInArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../schemas/auth.js";
import { InstantColumnSchema } from "./columns.js";

/**
 * oauth-grants.ts -- the OAuth clients a member allowed, read from the OAuth provider's own tables, and one client's tokens for that member revoked.
 *
 * The provider (`@better-auth/oauth-provider`) keeps a member's Allow as a
 * consent row per client, and what it minted on it as refresh and access
 * token rows, each naming the member and the client. It writes them
 * itself; the read here is how a hosted route lists a member's grants under
 * the Mac's OAuth token, since every endpoint of the provider's that lists
 * them takes a Better Auth session (`apps/web/server/README.md`). The one
 * write is the revoke: the provider exports nothing that revokes one
 * member's tokens for one client, its own family teardown being internal,
 * so it is written here as that teardown writes it, the access tokens
 * first and then the refresh tokens they name, for that member and that
 * client alone. Note that an access token minted as a JWT has no row, so
 * it stands until it expires. The consent is the provider's own to delete.
 *
 * Note that a client registered to skip consent, as the seeded first-party
 * ones are, leaves no consent row: the provider mints its tokens straight
 * away. Such a client is listed by the refresh tokens it holds for the
 * member instead, for as long as one of them is live, allowed when it was
 * first minted one, but only where the caller names it, so a first-party
 * client nobody meant to show, a retired one among them, never lists.
 */

/** One client the member allowed: its registered name and redirects, when they allowed it, and when it last traded a refresh token for a new one. */
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

/** The member's consents, each with its client's name and redirects, newest allowed first, leaving out the clients named. */
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

/**
 * The clients named that hold a live refresh token for the member with no
 * consent of theirs behind it, each allowed when its first token was
 * minted. Note that a refresh marks the token it spends revoked as it mints
 * the next, so a live token is one never spent, revoked, or rotated.
 */
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

/**
 * When each client last refreshed for the member: the newest rotation of
 * its refresh tokens, since a refresh marks the token it spends rotated as
 * it mints the next, so a client that never refreshed has none.
 */
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

/**
 * The clients the member allowed, by consent but for those left out, and by
 * a live token for the skip-consent clients named, newest allowed first,
 * each with when it last refreshed.
 */
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

/**
 * Deletes every access and refresh token the client holds for the member,
 * and no one else's: its next refresh finds no token, and a call on an
 * access token kept as a row finds none. Deleting what is already gone
 * deletes nothing, so a revoke retried after it landed does the same.
 */
export function revokeOAuthClientTokens(
  userId: string,
  clientId: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        // The access tokens go first, as the provider's teardown deletes them, since each may name a refresh token.
        yield* deleteAccessTokens({ userId, clientId });
        yield* deleteRefreshTokens({ userId, clientId });
      }),
    ),
  );
}
