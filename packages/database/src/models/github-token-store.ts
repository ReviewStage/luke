import { GITHUB_TOKEN_STATUS, type GitHubTokenStatus } from "@repo/features/github-token-wire";
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

export type GitHubTokenRow = typeof RowSchema.Type;

const OwnedRowSchema = Schema.Struct({ userId: Schema.String, ...RowSchema.fields });

export type OwnedGitHubTokenRow = typeof OwnedRowSchema.Type;

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

export function readGitHubTokenRow(userId: string): TaskStoreEffect<GitHubTokenRow | undefined> {
  return Effect.map(findRow(userId), Option.getOrUndefined);
}

export function linkedGitHubUserIds(userId: string): TaskStoreEffect<readonly string[]> {
  return Effect.map(findLinkedGitHubIds(userId), (rows) => rows.map((row) => row.githubUserId));
}

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

export function removeGitHubToken(userId: string): TaskStoreEffect<void> {
  return Effect.andThen(deleteRow(userId), forgetRepositoryReads(userId));
}

export function setGitHubTokenStatus(
  userId: string,
  sealedToken: string,
  status: GitHubTokenStatus,
  now: Date,
): TaskStoreEffect<void> {
  return updateStatus({ userId, sealedToken, status, now });
}

export function listEveryGitHubTokenRow(): TaskStoreEffect<readonly OwnedGitHubTokenRow[]> {
  return findEveryRow(undefined);
}

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
