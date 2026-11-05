/**
 * agent-repositories.ts -- the repositories an agent works in, its primary first, read as one list.
 *
 * An agent's primary repository is its own row's (`agent.repository`, its
 * start branch, its branch, and its pull request), and the repositories it
 * works in beside it are `agent_repository`'s rows, by position. Every
 * reader that must see an agent's extras reads them here, in that order,
 * and none reads the extras' table by itself: the token minted for the set,
 * the checkout, and the instructions. An agent with no repository has none,
 * since a Start names extras only beside a primary. The read is made as the
 * account the agent works for, as the agent reads itself (`agentReachableBy`),
 * so an account reads none of another's agent. A repository added to an
 * agent once it stands (`appendAgentRepository`) is written after its
 * extras, at the next position, under the agent row's lock.
 *
 * An extra's pull request is written here too, on its own row, as the agent
 * row keeps its own: the head branch `open_pull_request` opened it from, and
 * the pull request as GitHub last answered and when. An extra is named by
 * its repository, matched as GitHub matches one, its case aside, since a
 * Start names each repository once (`start.ts`'s `extraRepositoriesOf`).
 */

import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable, type StoredPublishedRead, type StoredPullRequest } from "../schemas/agent.js";
import { agentRepository } from "../schemas/agent-repository.js";
import {
  type AgentStoreEffect,
  newlyMerged,
  PublishedColumnSchema,
  PublishedReadColumnSchema,
} from "./agent-store.js";
import { agentReachableBy } from "./workspace-store.js";

/** One repository an agent works in: `owner/name`, the branch its checkout is cloned at and its pull request opens against, its pull request's head, and that pull request as GitHub last answered. */
export interface AgentRepositoryEntry {
  readonly repository: string;
  /** None for the repository's default branch. */
  readonly baseBranch: string | null;
  /** None until a pull request opens. */
  readonly headBranch: string | null;
  /** None before a read found one. */
  readonly pullRequest: StoredPullRequest | null;
}

const AgentRepositoryRowSchema = Schema.Struct({
  repository: Schema.NullOr(Schema.String),
  baseBranch: Schema.NullOr(Schema.String),
  headBranch: Schema.NullOr(Schema.String),
  pullRequest: Schema.NullOr(PublishedColumnSchema),
  extraPosition: Schema.NullOr(Schema.Number),
  extraRepository: Schema.NullOr(Schema.String),
  extraBaseBranch: Schema.NullOr(Schema.String),
  extraHeadBranch: Schema.NullOr(Schema.String),
  extraPullRequest: Schema.NullOr(PublishedColumnSchema),
});

/** The agent's row with each of its extras beside it, in their order: one row with no extra where it has none. */
const findAgentRepositories = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: AgentRepositoryRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          repository: agentTable.repository,
          baseBranch: agentTable.startBranch,
          headBranch: agentTable.branch,
          pullRequest: agentTable.published,
          extraPosition: agentRepository.position,
          extraRepository: agentRepository.repository,
          extraBaseBranch: agentRepository.baseBranch,
          extraHeadBranch: agentRepository.headBranch,
          extraPullRequest: agentRepository.published,
        })
        .from(agentTable)
        .leftJoin(agentRepository, eq(agentRepository.agentId, agentTable.id))
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId)))
        .orderBy(asc(agentRepository.position)),
    ),
});

/**
 * The repositories the agent works in, as the account reaches the agent:
 * its primary, from its own row, then its extras by position; none for an
 * agent with no repository, and none where the account does not reach the
 * agent.
 */
export function readAgentRepositories(
  userId: string,
  agentId: string,
): AgentStoreEffect<readonly AgentRepositoryEntry[]> {
  return Effect.map(findAgentRepositories({ userId, agentId }), (rows) => {
    const [first] = rows;
    if (first === undefined || first.repository === null) return [];
    const primary: AgentRepositoryEntry = {
      repository: first.repository,
      baseBranch: first.baseBranch,
      headBranch: first.headBranch,
      pullRequest: first.pullRequest,
    };
    const extras = rows.flatMap((row): AgentRepositoryEntry[] =>
      row.extraRepository === null
        ? []
        : [
            {
              repository: row.extraRepository,
              baseBranch: row.extraBaseBranch,
              headBranch: row.extraHeadBranch,
              pullRequest: row.extraPullRequest,
            },
          ],
    );
    return [primary, ...extras];
  });
}

/** The condition that a row is the named extra of an agent the account reaches. */
function extraOf(userId: string, agentId: string, repository: string): SQL | undefined {
  return and(
    eq(agentRepository.agentId, agentId),
    eq(sql`lower(${agentRepository.repository})`, repository.toLowerCase()),
    inArray(
      agentRepository.agentId,
      queryBuilder
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId))),
    ),
  );
}

const ExtraKeySchema = Schema.Struct({
  userId: Schema.String,
  agentId: Schema.String,
  repository: Schema.String,
});

const updateExtraHead = SqlSchema.void({
  Request: Schema.Struct({ ...ExtraKeySchema.fields, headBranch: Schema.String }),
  execute: ({ userId, agentId, repository, headBranch }) =>
    Database.use((db) =>
      db
        .update(agentRepository)
        .set({ headBranch })
        .where(extraOf(userId, agentId, repository)),
    ),
});

const lockExtraPublished = SqlSchema.findOneOption({
  Request: ExtraKeySchema,
  Result: Schema.Struct({ published: Schema.NullOr(PublishedColumnSchema) }),
  execute: ({ userId, agentId, repository }) =>
    Database.use((db) =>
      db
        .select({ published: agentRepository.published })
        .from(agentRepository)
        .where(extraOf(userId, agentId, repository))
        .limit(1)
        .for("update"),
    ),
});

const updateExtraPublished = SqlSchema.void({
  Request: Schema.Struct({
    ...ExtraKeySchema.fields,
    published: Schema.NullOr(PublishedColumnSchema),
    publishedRead: Schema.NullOr(PublishedReadColumnSchema),
  }),
  execute: ({ userId, agentId, repository, published, publishedRead }) =>
    Database.use((db) =>
      db
        .update(agentRepository)
        .set({ published, publishedRead })
        .where(extraOf(userId, agentId, repository)),
    ),
});

/** The head branch of the pull request the agent opened in a repository it works in beside its own, written on that repository's row; nothing written for a repository it does not work in, or an agent the account does not reach. */
export function recordAgentRepositoryHead(
  userId: string,
  agentId: string,
  repository: string,
  headBranch: string,
): AgentStoreEffect<void> {
  return updateExtraHead({ userId, agentId, repository, headBranch });
}

/**
 * The pull request from the head branch of a repository the agent works in
 * beside its own, as GitHub just answered, or null where it answered none,
 * with the read that found it, written on that repository's row as
 * `recordAgentPublished` writes the agent's own; nothing written for a
 * repository it does not work in, or an agent the account does not reach.
 * Answers whether this write is the one that first kept it merged, the row
 * locked as it is read.
 */
export function recordAgentRepositoryPublished(
  userId: string,
  agentId: string,
  repository: string,
  published: StoredPullRequest | null,
  read: StoredPublishedRead,
): AgentStoreEffect<boolean> {
  const key = { userId, agentId, repository };
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const kept = yield* lockExtraPublished(key);
        if (Option.isNone(kept)) return false;
        yield* updateExtraPublished({ ...key, published, publishedRead: read });
        return newlyMerged(kept.value.published, published);
      }),
    ),
  );
}

/** The agent's own repository under its row's lock, as the account reaches the agent; none where it does not. */
const lockAgentRepository = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ repository: Schema.NullOr(Schema.String) }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ repository: agentTable.repository })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId)))
        .for("update", { of: agentTable }),
    ),
});

/** The agent's extras by position, as far as an append reads them. */
const findExtraPositions = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ position: Schema.Number, repository: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({ position: agentRepository.position, repository: agentRepository.repository })
        .from(agentRepository)
        .where(eq(agentRepository.agentId, agentId)),
    ),
});

const insertAgentRepository = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    position: Schema.Number,
    repository: Schema.String,
    baseBranch: Schema.NullOr(Schema.String),
  }),
  execute: (row) => Database.use((db) => db.insert(agentRepository).values(row)),
});

/** Why a repository was not added beside an agent's own: the account does not reach the agent or it works in no repository of its own, it already works in this one, or in as many beside its own as a Start may name. */
export const APPEND_REFUSAL = {
  UNREACHED: "unreached",
  ALREADY: "already",
  FULL: "full",
} as const;

export type AppendRefusal = (typeof APPEND_REFUSAL)[keyof typeof APPEND_REFUSAL];

/**
 * A repository added to the agent beside the ones it works in, as the
 * account the agent works for reaches it: written after its extras, at the
 * position after the last, with the branch its checkout is cloned at, none
 * for its default branch. Answers the position written, or why not
 * (`APPEND_REFUSAL`): the account does not reach the agent or it works in no
 * repository of its own, it already works in this one, in any case, or in
 * as many beside its own as a Start may name
 * (`AGENT_BOUNDS.MAX_ALSO_REPOSITORIES`). The agent row is locked for the
 * read and the write, so two adds at once take two positions, never add one
 * repository twice, and never pass the bound.
 */
export function appendAgentRepository(
  userId: string,
  agentId: string,
  added: { readonly repository: string; readonly baseBranch: string | null },
): AgentStoreEffect<Result.Result<number, AppendRefusal>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        type Appended = Result.Result<number, AppendRefusal>;
        const refused = (why: AppendRefusal): Appended => Result.fail(why);
        const locked = yield* lockAgentRepository({ userId, agentId });
        if (Option.isNone(locked) || locked.value.repository === null) {
          return refused(APPEND_REFUSAL.UNREACHED);
        }
        const extras = yield* findExtraPositions({ agentId });
        const named = added.repository.toLowerCase();
        const every = [locked.value.repository, ...extras.map((extra) => extra.repository)];
        if (every.some((each) => each.toLowerCase() === named)) {
          return refused(APPEND_REFUSAL.ALREADY);
        }
        if (extras.length >= AGENT_BOUNDS.MAX_ALSO_REPOSITORIES) {
          return refused(APPEND_REFUSAL.FULL);
        }
        const position = Math.max(0, ...extras.map((extra) => extra.position)) + 1;
        yield* insertAgentRepository({ agentId, position, ...added });
        const appended: Appended = Result.succeed(position);
        return appended;
      }),
    ),
  );
}
