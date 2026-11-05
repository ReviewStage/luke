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

/**
 * github-repositories.ts -- GitHub's repositories by their own id, and every stored name moved along when one is renamed or transferred.
 *
 * Every table names a repository by its `owner/name` text, and every reader
 * matches it by that text: a webhook's repository against an agent's, a
 * listing against a task's, an automation's against a delivery's. GitHub
 * keeps a repository's id through a rename or a transfer and changes the
 * name, so each name is kept here as a label of the id: a sighting of the
 * repository, from a delivery or a read of GitHub, records the name GitHub
 * gives it now, and where that differs from the one its id was last seen
 * under, or from the one a rename's delivery says it had, relabels every
 * stored name in the same transaction, case-insensitively as GitHub reads
 * names, unless GitHub's `updated_at` says the sighting is older than the
 * one the id was last seen in. The relabel is the one write here that names no account, as
 * GitHub's delivery names a repository and nothing of who stored it; it
 * answers nothing of any row, so no account reads another's through it.
 *
 * Nothing is backfilled: a migration cannot ask GitHub, and every repository
 * is recorded the first time it is seen afterwards. One renamed before the
 * service saw it is still relabeled, by the old name its rename's delivery
 * carries, or by the name a read of GitHub under the old name was
 * redirected from.
 */

/** One sighting of a repository: GitHub's id for it, its name now, when GitHub last saw it change, and the name it went by before where the sighting says. */
export interface RepositorySighting {
  /** GitHub's id for the repository, which a rename or a transfer keeps. */
  readonly id: number;
  /** `owner/name` as GitHub spelled it as of the sighting. */
  readonly fullName: string;
  /** GitHub's `updated_at` for the repository as of the sighting, which a rename or a transfer moves; how a late delivery is told from a newer one. */
  readonly updatedAt: Date;
  /** `owner/name` as it was before, where the sighting names it: a rename's or a transfer's delivery, or a read redirected from it. */
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

/**
 * The id's row, held for the transaction, where the sighting may move it:
 * where it stands under another name, or for every sighting that names a
 * name before (`named`); nothing otherwise, which locks no row, so a
 * sighting under the name the id was last seen under locks nothing.
 */
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

/** Whether a column's `owner/name` is the one named, as GitHub reads a name, in any case. */
function namedAs(column: SQLWrapper, from: string): SQL {
  return sql`lower(${column}) = ${from.toLowerCase()}`;
}

/** Whether a JSON list of `owner/name` holds the old name, in any case but the new name's own spelling. */
function listsName(column: SQLWrapper, { from, to }: typeof RelabelSchema.Type): SQL {
  return sql`exists (select 1 from jsonb_array_elements_text(${column}) as listed(name) where lower(listed.name) = ${from.toLowerCase()} and listed.name <> ${to})`;
}

/** A JSON list of `owner/name` with the one named, in any case, given its new name, in the order it stood. */
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

/** Each account's pin of the old name copied under the new one, the earliest instant where it pinned it in more than one case; one it already holds under the new name stands. */
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

/** Each member's token read of the old name copied under the new one, kept lowercased as the table keeps it; one already asked under the new name stands. */
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

/**
 * The chapters of the old name that would stand twice on one head once
 * relabeled: each one where the workspace already holds that head's under
 * the new name, and of several spellings of the old name, every one but
 * the first made. The pull request's chapters stand under the new name.
 */
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

/** A workspace's token repository under the old name where it already holds the new one: the new one stands, and the table holds one per name in any case. */
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

/** Every stored name of the repository moved from the old name to the new one, in any case, each table keeping one row where it holds one per name. */
function relabel(move: typeof RelabelSchema.Type): TaskStoreEffect<void> {
  return Effect.gen(function* () {
    yield* relabelTasks(move);
    yield* relabelAgents(move);
    yield* relabelAgentRepositories(move);
    yield* relabelAutomations(move);
    yield* copyPins(move);
    yield* deleteRelabeledPins(move);
    // Note that the reads are keyed lowercased, so a rename that changes only the case moves none.
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

/**
 * Records a sighting of the repository, and where the name it was last seen
 * under, or the one the sighting says it had, is another than its name now,
 * moves every stored name from each of those to its name now, all in one
 * transaction. A sighting older than the one the id was last seen in, by
 * GitHub's own `updated_at`, moves nothing, since GitHub delivers late and
 * redelivers, and a late delivery's name may be one the repository left
 * behind. A sighting under the name it was last seen under writes nothing
 * past the first, and locks nothing.
 */
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
