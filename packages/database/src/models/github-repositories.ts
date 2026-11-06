import { and, eq, lt, ne, or, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentRepository } from "../schemas/agent-repository.js";
import { automation } from "../schemas/automation.js";
import { githubRepository } from "../schemas/github-repository.js";
import { githubRepositoryRead } from "../schemas/github-repository-read.js";
import { pullRequestChapters } from "../schemas/pull-request-chapters.js";
import { repositoryPin } from "../schemas/repository-pin.js";
import { task } from "../schemas/task.js";
import { workspaceTokenRepository } from "../schemas/workspace-token-repository.js";
import type { TaskStoreEffect } from "./task-store.js";

export interface RepositorySighting {
  readonly id: number;
  readonly fullName: string;
  readonly updatedAt: Date;
  readonly formerly?: string | undefined;
}

const SightingSchema = Schema.Struct({
  id: Schema.Number,
  fullName: Schema.String,
  updatedAt: Schema.Date,
});

const RelabelSchema = Schema.Struct({ from: Schema.String, to: Schema.String });

const insertSeen = SqlSchema.void({
  Request: SightingSchema,
  execute: ({ id, fullName, updatedAt }) =>
    Database.use((db) =>
      db
        .insert(githubRepository)
        .values({ id, fullName, githubUpdatedAt: updatedAt })
        .onConflictDoNothing(),
    ),
});

const lockSeen = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...SightingSchema.fields, named: Schema.Boolean }),
  Result: Schema.Struct({ fullName: Schema.String, githubUpdatedAt: Schema.Date }),
  execute: ({ id, fullName, named }) =>
    Database.use((db) =>
      db
        .select({
          fullName: githubRepository.fullName,
          githubUpdatedAt: githubRepository.githubUpdatedAt,
        })
        .from(githubRepository)
        .where(
          named
            ? eq(githubRepository.id, id)
            : and(eq(githubRepository.id, id), ne(githubRepository.fullName, fullName)),
        )
        .for("update"),
    ),
});

const updateSeen = SqlSchema.void({
  Request: SightingSchema,
  execute: ({ id, fullName, updatedAt }) =>
    Database.use((db) =>
      db
        .update(githubRepository)
        .set({ fullName, githubUpdatedAt: updatedAt })
        .where(eq(githubRepository.id, id)),
    ),
});

function namedAs(column: SQLWrapper, from: string): SQL {
  return sql`lower(${column}) = ${from.toLowerCase()}`;
}

function listsName(column: SQLWrapper, { from, to }: typeof RelabelSchema.Type): SQL {
  return sql`exists (select 1 from jsonb_array_elements_text(${column}) as listed(name) where lower(listed.name) = ${from.toLowerCase()} and listed.name <> ${to})`;
}

function relabeledList(column: SQLWrapper, { from, to }: typeof RelabelSchema.Type): SQL {
  return sql`(select coalesce(jsonb_agg(case when lower(listed.name) = ${from.toLowerCase()} then ${to} else listed.name end order by listed.place), '[]'::jsonb) from jsonb_array_elements_text(${column}) with ordinality as listed(name, place))`;
}

const relabelTasks = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .update(task)
        .set({ repository: to })
        .where(and(namedAs(task.repository, from), ne(task.repository, to))),
    ),
});

const relabelAgents = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ repository: to })
        .where(and(namedAs(agentTable.repository, from), ne(agentTable.repository, to))),
    ),
});

const relabelAgentRepositories = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .update(agentRepository)
        .set({ repository: to })
        .where(and(namedAs(agentRepository.repository, from), ne(agentRepository.repository, to))),
    ),
});

const relabelAutomations = SqlSchema.void({
  Request: RelabelSchema,
  execute: (move) =>
    Database.use((db) =>
      db
        .update(automation)
        .set({ repositories: relabeledList(automation.repositories, move) })
        .where(listsName(automation.repositories, move)),
    ),
});

const copyPins = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .insert(repositoryPin)
        .select((qb) =>
          qb
            .select({
              userId: repositoryPin.userId,
              repository: sql<string>`${to}::text`.as("repository"),
              pinnedAt: sql<Date>`min(${repositoryPin.pinnedAt})`.as("pinned_at"),
            })
            .from(repositoryPin)
            .where(and(namedAs(repositoryPin.repository, from), ne(repositoryPin.repository, to)))
            .groupBy(repositoryPin.userId),
        )
        .onConflictDoNothing(),
    ),
});

const deleteRelabeledPins = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .delete(repositoryPin)
        .where(and(namedAs(repositoryPin.repository, from), ne(repositoryPin.repository, to))),
    ),
});

const copyReads = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .insert(githubRepositoryRead)
        .select((qb) =>
          qb
            .select({
              userId: githubRepositoryRead.userId,
              repository: sql<string>`${to.toLowerCase()}::text`.as("repository"),
              readable: githubRepositoryRead.readable,
              checkedAt: githubRepositoryRead.checkedAt,
            })
            .from(githubRepositoryRead)
            .where(eq(githubRepositoryRead.repository, from.toLowerCase())),
        )
        .onConflictDoNothing(),
    ),
});

const deleteRelabeledReads = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from }) =>
    Database.use((db) =>
      db
        .delete(githubRepositoryRead)
        .where(eq(githubRepositoryRead.repository, from.toLowerCase())),
    ),
});

const otherChapters = alias(pullRequestChapters, "other_chapters");

const deleteDuplicateChapters = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db.delete(pullRequestChapters).where(
        and(
          namedAs(pullRequestChapters.repository, from),
          ne(pullRequestChapters.repository, to),
          sql`exists ${queryBuilder
            .select({ one: otherChapters.id })
            .from(otherChapters)
            .where(
              and(
                eq(otherChapters.organizationId, pullRequestChapters.organizationId),
                eq(otherChapters.pullRequestNumber, pullRequestChapters.pullRequestNumber),
                eq(otherChapters.headSha, pullRequestChapters.headSha),
                ne(otherChapters.id, pullRequestChapters.id),
                or(
                  eq(otherChapters.repository, to),
                  and(
                    namedAs(otherChapters.repository, from),
                    or(
                      lt(otherChapters.createdAt, pullRequestChapters.createdAt),
                      and(
                        eq(otherChapters.createdAt, pullRequestChapters.createdAt),
                        lt(otherChapters.id, pullRequestChapters.id),
                      ),
                    ),
                  ),
                ),
              ),
            )}`,
        ),
      ),
    ),
});

const relabelChapters = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .update(pullRequestChapters)
        .set({ repository: to })
        .where(
          and(
            namedAs(pullRequestChapters.repository, from),
            ne(pullRequestChapters.repository, to),
          ),
        ),
    ),
});

const otherTokenRepository = alias(workspaceTokenRepository, "other_token_repository");

const deleteDuplicateTokenRepositories = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db.delete(workspaceTokenRepository).where(
        and(
          namedAs(workspaceTokenRepository.repository, from),
          sql`exists ${queryBuilder
            .select({ one: otherTokenRepository.id })
            .from(otherTokenRepository)
            .where(
              and(
                eq(otherTokenRepository.organizationId, workspaceTokenRepository.organizationId),
                namedAs(otherTokenRepository.repository, to),
                ne(otherTokenRepository.id, workspaceTokenRepository.id),
              ),
            )}`,
        ),
      ),
    ),
});

const relabelTokenRepositories = SqlSchema.void({
  Request: RelabelSchema,
  execute: ({ from, to }) =>
    Database.use((db) =>
      db
        .update(workspaceTokenRepository)
        .set({ repository: to })
        .where(
          and(
            namedAs(workspaceTokenRepository.repository, from),
            ne(workspaceTokenRepository.repository, to),
          ),
        ),
    ),
});

function relabel(move: typeof RelabelSchema.Type): TaskStoreEffect<void> {
  return Effect.gen(function* () {
    yield* relabelTasks(move);
    yield* relabelAgents(move);
    yield* relabelAgentRepositories(move);
    yield* relabelAutomations(move);
    yield* copyPins(move);
    yield* deleteRelabeledPins(move);
    if (move.from.toLowerCase() !== move.to.toLowerCase()) {
      yield* copyReads(move);
      yield* deleteRelabeledReads(move);
    }
    yield* deleteDuplicateChapters(move);
    yield* relabelChapters(move);
    yield* deleteDuplicateTokenRepositories(move);
    yield* relabelTokenRepositories(move);
  });
}

export function noteGitHubRepository(sighting: RepositorySighting): TaskStoreEffect<void> {
  const seen = { id: sighting.id, fullName: sighting.fullName, updatedAt: sighting.updatedAt };
  const named = sighting.formerly !== undefined && sighting.formerly !== sighting.fullName;
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* insertSeen(seen);
        const stood = yield* lockSeen({ ...seen, named });
        if (Option.isNone(stood) && !named) return;
        const formerNames = new Set<string>();
        if (Option.isSome(stood)) {
          if (stood.value.githubUpdatedAt.getTime() > sighting.updatedAt.getTime()) return;
          if (stood.value.fullName !== sighting.fullName) {
            yield* updateSeen(seen);
            formerNames.add(stood.value.fullName);
          }
        }
        if (named && sighting.formerly !== undefined) formerNames.add(sighting.formerly);
        for (const from of formerNames) yield* relabel({ from, to: sighting.fullName });
      }),
    ),
  );
}
