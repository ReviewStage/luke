import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { and, eq, gte, isNotNull, ne, notExists, type SQLWrapper, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { member } from "../schemas/auth.js";
import { githubPersonalToken } from "../schemas/github-personal-token.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { task } from "../schemas/task.js";
import type { TaskStoreEffect } from "./task-store.js";

export interface RepositoryRead {
  readonly repository: string;
  readonly readable: boolean;
}

const UNASKED_REQUEST = Schema.Struct({ userId: Schema.String, since: Schema.Date });

const RepositoryRowSchema = Schema.Struct({ repository: Schema.String });

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

const findUnaskedAgentRepositories = SqlSchema.findAll({
  Request: UNASKED_REQUEST,
  Result: RepositoryRowSchema,
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .selectDistinct({ repository: sql<string>`lower(${agentTable.repository})` })
        .from(member)
        .innerJoin(agentTable, eq(agentTable.organizationId, member.organizationId))
        .where(
          and(
            eq(member.userId, userId),
            eq(agentTable.githubAccess, GITHUB_ACCESS.TOKEN),
            ne(agentTable.userId, userId),
            isNotNull(agentTable.repository),
            notExists(askedSince(userId, agentTable.repository, since)),
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

export function forgetRepositoryReads(userId: string): TaskStoreEffect<void> {
  return deleteReads(userId);
}
