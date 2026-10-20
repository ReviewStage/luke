import { GITHUB_TOKEN_STATUS, type GitHubTokenStatus } from "@luke/features/github-token-wire";
import { and, asc, desc, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { account } from "../schemas/auth.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { InstantColumnSchema } from "./columns.js";
import { forgetRepositoryReads } from "./github-repository-reads.js";
import type { SealedGitHubToken } from "./provider-key-seal.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * github-token-store.ts -- the row of a member's own GitHub personal access token, sealed as `provider-key-seal.ts` seals it.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account reads, replaces, or removes another's token. What
 * goes in and out is sealed: this module never sees a token in the clear,
 * and a row read here is opened by its caller with the ring the environment
 * holds. A save replaces the row whole, as a token added now and verified
 * now, since a token is saved only once GitHub accepted it. A status is
 * written against the sealed token a step ran on, so a step on a token since
 * replaced marks nothing of its successor. A save and a removal each forget
 * which repositories the member's token was answered for
 * (`github-repository-reads.ts`), since another token may read others.
 */

/** Better Auth's provider id for GitHub on an account row. */
const GITHUB_PROVIDER_ID = "github";

const StatusSchema = Schema.Literals(Object.values(GITHUB_TOKEN_STATUS));

const RowSchema = Schema.Struct({
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedToken: Schema.String,
  hint: Schema.String,
  githubUserId: Schema.String,
  githubLogin: Schema.String,
  expiresAt: Schema.NullOr(InstantColumnSchema),
  status: StatusSchema,
  statusAt: InstantColumnSchema,
  createdAt: InstantColumnSchema,
});

/** The member's token as its row holds it: sealed, beside what the member is shown of it. */
export type GitHubTokenRow = typeof RowSchema.Type;

const OwnedRowSchema = Schema.Struct({ userId: Schema.String, ...RowSchema.fields });

/** One stored token with its account, for the rewrap that walks every row. */
export type OwnedGitHubTokenRow = typeof OwnedRowSchema.Type;

/** What GitHub answered of a token at its save, kept beside the seal. */
export interface GitHubTokenFacts {
  readonly hint: string;
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly expiresAt: Date | null;
}

const ROW_COLUMNS = {
  keyVersion: githubPersonalToken.keyVersion,
  sealedDataKey: githubPersonalToken.sealedDataKey,
  sealedToken: githubPersonalToken.sealedToken,
  hint: githubPersonalToken.hint,
  githubUserId: githubPersonalToken.githubUserId,
  githubLogin: githubPersonalToken.githubLogin,
  expiresAt: githubPersonalToken.expiresAt,
  status: githubPersonalToken.status,
  statusAt: githubPersonalToken.statusAt,
  createdAt: githubPersonalToken.createdAt,
} as const;

const findRow = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: RowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(githubPersonalToken)
        .where(eq(githubPersonalToken.userId, userId))
        .limit(1),
    ),
});

const findEveryRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: OwnedRowSchema,
  execute: () =>
    Database.use((db) =>
      db
        .select({ userId: githubPersonalToken.userId, ...ROW_COLUMNS })
        .from(githubPersonalToken)
        .orderBy(asc(githubPersonalToken.userId)),
    ),
});

/** The GitHub ids the account's linked GitHub rows name, newest first. */
const findLinkedGitHubIds = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ githubUserId: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ githubUserId: account.accountId })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, GITHUB_PROVIDER_ID)))
        .orderBy(desc(account.updatedAt)),
    ),
});

const upsertRow = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedToken: Schema.String,
    hint: Schema.String,
    githubUserId: Schema.String,
    githubLogin: Schema.String,
    expiresAt: Schema.NullOr(Schema.Date),
    now: Schema.Date,
  }),
  execute: (write) => {
    const row = {
      keyVersion: write.keyVersion,
      sealedDataKey: write.sealedDataKey,
      sealedToken: write.sealedToken,
      hint: write.hint,
      githubUserId: write.githubUserId,
      githubLogin: write.githubLogin,
      expiresAt: write.expiresAt,
      status: GITHUB_TOKEN_STATUS.VERIFIED,
      statusAt: write.now,
      createdAt: write.now,
    };
    return Database.use((db) =>
      db
        .insert(githubPersonalToken)
        .values({ userId: write.userId, ...row })
        .onConflictDoUpdate({ target: githubPersonalToken.userId, set: row }),
    );
  },
});

const deleteRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    Database.use((db) =>
      db.delete(githubPersonalToken).where(eq(githubPersonalToken.userId, userId)),
    ),
});

const updateStatus = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    sealedToken: Schema.String,
    status: StatusSchema,
    now: Schema.Date,
  }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(githubPersonalToken)
        .set({ status: write.status, statusAt: write.now })
        .where(
          and(
            eq(githubPersonalToken.userId, write.userId),
            eq(githubPersonalToken.sealedToken, write.sealedToken),
          ),
        ),
    ),
});

/** The wrap moved only where the row still holds the seal it was read with, so a token replaced meanwhile keeps its own. */
const rewrapRow = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    fromVersion: Schema.Int,
    sealedToken: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
  }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(githubPersonalToken)
        .set({ keyVersion: write.keyVersion, sealedDataKey: write.sealedDataKey })
        .where(
          and(
            eq(githubPersonalToken.userId, write.userId),
            eq(githubPersonalToken.keyVersion, write.fromVersion),
            eq(githubPersonalToken.sealedToken, write.sealedToken),
          ),
        )
        .returning({ userId: githubPersonalToken.userId }),
    ),
});

/** The member's stored token, sealed, or nothing where they keep none. */
export function readGitHubTokenRow(userId: string): TaskStoreEffect<GitHubTokenRow | undefined> {
  return Effect.map(findRow(userId), Option.getOrUndefined);
}

/** The GitHub ids of every GitHub account the member linked to Luke, newest first; empty where they linked none. */
export function linkedGitHubUserIds(userId: string): TaskStoreEffect<readonly string[]> {
  return Effect.map(findLinkedGitHubIds(userId), (rows) => rows.map((row) => row.githubUserId));
}

/** Keeps the member's token, replacing the one they held, as added and verified now, and forgets what the one before read. */
export function saveGitHubToken(
  userId: string,
  sealed: SealedGitHubToken,
  facts: GitHubTokenFacts,
  now: Date,
): TaskStoreEffect<void> {
  return Effect.andThen(
    upsertRow({ userId, ...sealed, ...facts, now }),
    forgetRepositoryReads(userId),
  );
}

/** Removes the member's token, and what it read; removing one they do not hold moves nothing. */
export function removeGitHubToken(userId: string): TaskStoreEffect<void> {
  return Effect.andThen(deleteRow(userId), forgetRepositoryReads(userId));
}

/** Writes how GitHub last answered the token a step ran on, where the row still holds that token. */
export function setGitHubTokenStatus(
  userId: string,
  sealedToken: string,
  status: GitHubTokenStatus,
  now: Date,
): TaskStoreEffect<void> {
  return updateStatus({ userId, sealedToken, status, now });
}

/** Every stored token of every account, sealed, for the rewrap alone. */
export function listEveryGitHubTokenRow(): TaskStoreEffect<readonly OwnedGitHubTokenRow[]> {
  return findEveryRow(undefined);
}

/**
 * Moves one row onto a new wrap of its data key, and answers whether it
 * did: not where the row was replaced or rewrapped since it was read.
 */
export function rewrapGitHubTokenRow(
  row: OwnedGitHubTokenRow,
  rewrapped: SealedGitHubToken,
): TaskStoreEffect<boolean> {
  return Effect.map(
    rewrapRow({
      userId: row.userId,
      fromVersion: row.keyVersion,
      sealedToken: row.sealedToken,
      keyVersion: rewrapped.keyVersion,
      sealedDataKey: rewrapped.sealedDataKey,
    }),
    (moved) => moved.length > 0,
  );
}
