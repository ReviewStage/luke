import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { and, eq, gte, isNotNull, ne, notExists, type SQLWrapper, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { task } from "../schemas/task.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * github-repository-reads.ts -- which repositories a member's own GitHub token reads, as the service last asked GitHub.
 *
 * The store side of `github_repository_read`: the repositories of the tasks
 * and coding agents another member reached on their own token, in the
 * member's workspaces, that the member's token was not asked about since a
 * given instant, and the answers the service brings back. A token saved or
 * removed forgets its member's answers (`github-token-store.ts`), so the
 * next read asks afresh, and answers are kept only under the lock of the
 * token row that still holds the token they were asked on, so a token
 * replaced while GitHub was asked keeps none of its predecessor's. Every function is an effect over the ambient
 * `SqlClient`, keyed by the account.
 */

/** One repository as the member's token was answered for it. */
export interface RepositoryRead {
  /** `owner/name`, in any case; it is kept lowercased. */
  readonly repository: string;
  readonly readable: boolean;
}

const UNASKED_REQUEST = Schema.Struct({ userId: Schema.String, since: Schema.Date });

const RepositoryRowSchema = Schema.Struct({ repository: Schema.String });

/** The condition that the member's token was answered for the repository a column names at or after `since`. */
function askedSince(userId: string, repository: SQLWrapper, since: Date) {
  return queryBuilder
    .select({ one: githubRepositoryRead.userId })
    .from(githubRepositoryRead)
    .where(
      and(
        eq(githubRepositoryRead.userId, userId),
        eq(githubRepositoryRead.repository, sql`lower(${repository})`),
        gte(githubRepositoryRead.checkedAt, since),
      ),
    );
}

/** The token tasks of the member's workspaces another member owns, whose repository the member's token was not answered for since. */
const findUnaskedTaskRepositories = SqlSchema.findAll({
  Request: UNASKED_REQUEST,
  Result: RepositoryRowSchema,
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .selectDistinct({ repository: sql<string>`lower(${task.repository})` })
        .from(member)
        .innerJoin(task, eq(task.organizationId, member.organizationId))
        .where(
          and(
            eq(member.userId, userId),
            eq(task.githubAccess, GITHUB_ACCESS.TOKEN),
            ne(task.userId, userId),
            isNotNull(task.repository),
            notExists(askedSince(userId, task.repository, since)),
          ),
        ),
    ),
});

/** The same of the member's workspaces' token agents, which name their workspace on their own row. */
const findUnaskedAgentRepositories = SqlSchema.findAll({
  Request: UNASKED_REQUEST,
  Result: RepositoryRowSchema,
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .selectDistinct({ repository: sql<string>`lower(${codingAgent.repository})` })
        .from(member)
        .innerJoin(codingAgent, eq(codingAgent.organizationId, member.organizationId))
        .where(
          and(
            eq(member.userId, userId),
            eq(codingAgent.githubAccess, GITHUB_ACCESS.TOKEN),
            ne(codingAgent.userId, userId),
            notExists(askedSince(userId, codingAgent.repository, since)),
          ),
        ),
    ),
});

const upsertRead = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    repository: Schema.String,
    readable: Schema.Boolean,
    now: Schema.Date,
  }),
  execute: ({ userId, repository, readable, now }) =>
    Database.use((db) =>
      db
        .insert(githubRepositoryRead)
        .values({ userId, repository, readable, checkedAt: now })
        .onConflictDoUpdate({
          target: [githubRepositoryRead.userId, githubRepositoryRead.repository],
          set: { readable, checkedAt: now },
        }),
    ),
});

/** The member's token row under its own lock, as far as which token it holds; the same lock a save or a removal waits on. */
const lockTokenSeal = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ sealedToken: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ sealedToken: githubPersonalToken.sealedToken })
        .from(githubPersonalToken)
        .where(eq(githubPersonalToken.userId, userId))
        .for("update"),
    ),
});

const deleteReads = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    Database.use((db) =>
      db.delete(githubRepositoryRead).where(eq(githubRepositoryRead.userId, userId)),
    ),
});

/**
 * The repositories, lowercased, of the tasks and coding agents of the
 * member's workspaces that another member reached on their own token, which
 * the member's token was not answered for at or after `since`; each once.
 */
export function unaskedTokenRepositories(
  userId: string,
  since: Date,
): TaskStoreEffect<readonly string[]> {
  return Effect.gen(function* () {
    const tasks = yield* findUnaskedTaskRepositories({ userId, since });
    const agents = yield* findUnaskedAgentRepositories({ userId, since });
    return [...new Set([...tasks, ...agents].map((row) => row.repository))];
  });
}

/**
 * Keeps how GitHub answered the member's token for each repository, as of
 * now, where the member still keeps the token they were asked on (its seal,
 * `sealedToken`); answers whether they were kept.
 */
export function recordRepositoryReads(
  userId: string,
  sealedToken: string,
  reads: readonly RepositoryRead[],
  now: Date,
): TaskStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const held = yield* lockTokenSeal(userId);
        if (Option.getOrUndefined(held)?.sealedToken !== sealedToken) return false;
        for (const read of reads) {
          const repository = read.repository.toLowerCase();
          yield* upsertRead({ userId, repository, readable: read.readable, now });
        }
        return true;
      }),
    ),
  );
}

/** Forgets every answer kept for the member's token, so the next read asks GitHub afresh. */
export function forgetRepositoryReads(userId: string): TaskStoreEffect<void> {
  return deleteReads(userId);
}
