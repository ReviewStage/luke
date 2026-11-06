import { randomBytes } from "node:crypto";
import {
  GITHUB_CONNECT_CLAIM,
  type GitHubConnectClaim,
  type GitHubConnection,
} from "@repo/features/github-connection-wire";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { account } from "../schemas/auth.js";
import { githubConnectIntent } from "../schemas/github-connect-intent.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";

export const GITHUB_CONNECT_INTENT_LIFETIME = Duration.minutes(10);

const GITHUB_PROVIDER_ID = "github";

const INTENT_ID_BYTES = 32;

const insertIntent = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
    expiresAt: Schema.Date,
  }),
  execute: (intent) =>
    Database.use((db) =>
      db.insert(githubConnectIntent).values({
        id: intent.id,
        userId: intent.userId,
        expiresAt: intent.expiresAt,
        createdAt: intent.now,
      }),
    ),
});

const deleteExpiredIntents = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(githubConnectIntent)
        .where(
          and(
            eq(githubConnectIntent.userId, key.userId),
            lte(githubConnectIntent.expiresAt, key.now),
          ),
        ),
    ),
});

const findStandingIntent = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ userId: githubConnectIntent.userId })
        .from(githubConnectIntent)
        .where(and(eq(githubConnectIntent.id, key.id), gt(githubConnectIntent.expiresAt, key.now))),
    ),
});

const GitHubAccountTokensSchema = Schema.Struct({
  accessToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
  refreshTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
});

type GitHubAccountTokens = typeof GitHubAccountTokensSchema.Type;

const findNewestGitHubAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: GitHubAccountTokensSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          accessTokenExpiresAt: account.accessTokenExpiresAt,
          refreshTokenExpiresAt: account.refreshTokenExpiresAt,
        })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, GITHUB_PROVIDER_ID)))
        .orderBy(desc(account.updatedAt))
        .limit(1),
    ),
});

function usableAt(row: GitHubAccountTokens, now: Date): boolean {
  if (row.accessToken === null || row.refreshToken === null) return false;
  if (row.accessTokenExpiresAt === null) return false;
  if (row.accessTokenExpiresAt > now) return true;
  return row.refreshTokenExpiresAt === null || row.refreshTokenExpiresAt > now;
}

export function openGitHubConnectIntent(userId: string): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const now = yield* DateTime.now;
    const id = randomBytes(INTENT_ID_BYTES).toString("base64url");
    const expiresAt = DateTime.toDate(DateTime.addDuration(now, GITHUB_CONNECT_INTENT_LIFETIME));
    yield* deleteExpiredIntents({ userId, now: DateTime.toDate(now) });
    yield* insertIntent({ id, userId, now: DateTime.toDate(now), expiresAt });
    return id;
  });
}

export function claimGitHubConnectIntent(
  intentId: string,
  userId: string,
): TaskStoreEffect<GitHubConnectClaim> {
  return Effect.gen(function* () {
    const now = DateTime.toDate(yield* DateTime.now);
    const standing = yield* findStandingIntent({ id: intentId, now });
    if (Option.isNone(standing)) return GITHUB_CONNECT_CLAIM.EXPIRED;
    return standing.value.userId === userId
      ? GITHUB_CONNECT_CLAIM.CLAIMED
      : GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT;
  });
}

export function githubConnection(userId: string): TaskStoreEffect<GitHubConnection> {
  return Effect.gen(function* () {
    const now = DateTime.toDate(yield* DateTime.now);
    const row = yield* findNewestGitHubAccount(userId);
    return { connected: Option.exists(row, (tokens) => usableAt(tokens, now)), login: null };
  });
}
