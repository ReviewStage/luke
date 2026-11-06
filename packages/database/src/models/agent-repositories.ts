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

export interface AgentRepositoryEntry {
  readonly repository: string;
  readonly baseBranch: string | null;
  readonly headBranch: string | null;
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

export function recordAgentRepositoryHead(
  userId: string,
  agentId: string,
  repository: string,
  headBranch: string,
): AgentStoreEffect<void> {
  return updateExtraHead({ userId, agentId, repository, headBranch });
}

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

export const APPEND_REFUSAL = {
  UNREACHED: "unreached",
  ALREADY: "already",
  FULL: "full",
} as const;

export type AppendRefusal = (typeof APPEND_REFUSAL)[keyof typeof APPEND_REFUSAL];

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
