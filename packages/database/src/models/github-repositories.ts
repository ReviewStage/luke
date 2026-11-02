import { and, eq, lt, ne, or, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
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
 * names. The relabel is the one write here that names no account, as
 * GitHub's delivery names a repository and nothing of who stored it; it
 * answers nothing of any row, so no account reads another's through it.
 *
 * Nothing is backfilled: a migration cannot ask GitHub, and every repository
 * is recorded the first time it is seen afterwards. One renamed before the
 * service saw it is still relabeled, by the old name its rename's delivery
 * carries, or by the name a read of GitHub under the old name was
 * redirected from.
 */

/** One sighting of a repository: GitHub's id for it, its name now, and the name it went by before where the sighting says. */
export interface RepositorySighting {
  /** GitHub's id for the repository, which a rename or a transfer keeps. */
  readonly id: number;
  /** `owner/name` as GitHub spells it now. */
  readonly fullName: string;
  /** `owner/name` as it was before, where the sighting names it: a rename's or a transfer's delivery, or a read redirected from it. */
  readonly formerly?: string | undefined;
}

const SightingSchema = Schema.Struct({ id: Schema.Number, fullName: Schema.String });

const RelabelSchema = Schema.Struct({ from: Schema.String, to: Schema.String });

const insertSeen = SqlSchema.void({
  Request: SightingSchema,
  execute: ({ id, fullName }) =>
    Database.use((db) =>
      db.insert(githubRepository).values({ id, fullName }).onConflictDoNothing(),
    ),
});

/** The name the id was last seen under, held for the transaction, where it is another than this one; nothing where it is this one, which locks no row. */
const lockStaleName = SqlSchema.findOneOption({
  Request: SightingSchema,
  Result: Schema.Struct({ fullName: Schema.String }),
  execute: ({ id, fullName }) =>
    Database.use((db) =>
      db
        .select({ fullName: githubRepository.fullName })
        .from(githubRepository)
        .where(and(eq(githubRepository.id, id), ne(githubRepository.fullName, fullName)))
        .for("update"),
    ),
});

const updateSeen = SqlSchema.void({
  Request: SightingSchema,
  execute: ({ id, fullName }) =>
    Database.use((db) =>
      db.update(githubRepository).set({ fullName }).where(eq(githubRepository.id, id)),
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
  execute: (move) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({
          repository: sql`case when ${namedAs(agentTable.repository, move.from)} then ${move.to} else ${agentTable.repository} end`,
          repositories: relabeledList(agentTable.repositories, move),
        })
        .where(
          or(
            and(namedAs(agentTable.repository, move.from), ne(agentTable.repository, move.to)),
            listsName(agentTable.repositories, move),
          ),
        ),
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
 * transaction. A sighting under the name it was last seen under writes
 * nothing past the first, and locks nothing.
 */
export function noteGitHubRepository(sighting: RepositorySighting): TaskStoreEffect<void> {
  const seen = { id: sighting.id, fullName: sighting.fullName };
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* insertSeen(seen);
        const stale = yield* lockStaleName(seen);
        if (Option.isSome(stale)) yield* updateSeen(seen);
        const formerNames = new Set<string>();
        if (Option.isSome(stale)) formerNames.add(stale.value.fullName);
        if (sighting.formerly !== undefined && sighting.formerly !== sighting.fullName) {
          formerNames.add(sighting.formerly);
        }
        for (const from of formerNames) yield* relabel({ from, to: sighting.fullName });
      }),
    ),
  );
}
