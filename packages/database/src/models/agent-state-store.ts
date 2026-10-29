/**
 * agent-state-store.ts -- a device agent's saved state: its newest generation, the checked commit of the next, its sealed key, and what the sweep may delete.
 *
 * Every function but the sweep's is an effect over the ambient `SqlClient`,
 * keyed by the account, and reaches an agent only through the agent's own
 * row and the account that started it, so no account reads, commits, or
 * keys another's agent's state. A generation row outlives its agent
 * (`../schemas/agent-state.ts`), and once the agent's row is gone the join
 * finds nothing, so only the sweep reaches it.
 *
 * A commit is a check-and-set on the newest generation: it is accepted only
 * where the generation its saver started from, none for a first save, is
 * still the agent's newest, and only from the device the agent is pinned
 * to, and writes the next one. Two commits from one generation write one
 * row, since the second meets the first's on the agent's unique generation,
 * so a stale saver never writes over a newer save.
 *
 * The state key is minted and sealed where the agent has none
 * (`mintAgentStateKey`), and this module only ever holds and answers it
 * sealed; `openAgentStateKey` beside the seal is the one way to read it.
 * The key rotation's rewrap reads every key's row and moves each onto the
 * ring's current version, never opening the key itself.
 *
 * The sweep is the deployment's and reads every account. It answers a
 * generation superseded by a newer one of its agent; every generation of an
 * agent whose transcript is gone, its conversation purged seven days after
 * the agent or its task was deleted (`./soft-delete.ts`) or deleted with the
 * account, so saved state goes when the transcript goes; and every
 * generation committed at least seven days ago, the newest included,
 * whether or not its agent is archived, as a cloud agent's sandbox snapshot
 * goes seven days after its last use, so an agent woken after that starts
 * fresh from its branch. The caller deletes each generation's blob, then
 * its row.
 */

import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  lte,
  max,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Data, Duration, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentStateGeneration, agentStateKey } from "../schemas/agent-state.js";
import { conversations } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";
import { type KeyRing, mintAgentStateKey, type SealedAgentStateKey } from "./provider-key-seal.js";
import type { TaskStoreEffect } from "./task-store.js";

/** How long a generation of saved state stands past its commit before the sweep may delete it, the agent's newest included. */
const AGENT_STATE_RETENTION_MS = Duration.toMillis(Duration.days(7));

/** The commit's generation is no longer the agent's newest: a newer save landed since its saver started. */
export class AgentStateStale extends Data.TaggedError("AgentStateStale")<{
  /** The agent's newest generation now; null where it has none. */
  readonly newest: number | null;
}> {}

/** The account reaches no such agent, or the agent is not pinned to the device that asked. */
export class AgentStateUnreachable extends Data.TaggedError("AgentStateUnreachable") {}

const GenerationSchema = Schema.Struct({
  agentId: Schema.String,
  generation: Schema.Int,
  path: Schema.String,
  bytes: Schema.Int,
  sha256: Schema.String,
  baseCommit: Schema.NullOr(Schema.String),
  deviceId: Schema.NullOr(Schema.String),
  savedAt: InstantColumnSchema,
});

/** One committed generation of an agent's saved state. */
export type AgentStateGeneration = typeof GenerationSchema.Type;

const GENERATION_COLUMNS = {
  agentId: agentStateGeneration.agentId,
  generation: agentStateGeneration.generation,
  path: agentStateGeneration.path,
  bytes: agentStateGeneration.bytes,
  sha256: agentStateGeneration.sha256,
  baseCommit: agentStateGeneration.baseCommit,
  deviceId: agentStateGeneration.deviceId,
  savedAt: agentStateGeneration.savedAt,
} as const;

const SealedKeySchema = Schema.Struct({
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedKey: Schema.String,
});

const KeyRowSchema = Schema.Struct({
  userId: Schema.String,
  agentId: Schema.String,
  ...SealedKeySchema.fields,
});

/** One agent's sealed state key, with whose it is, as the rotation's rewrap reads it. */
export type AgentStateKeyRow = typeof KeyRowSchema.Type;

const SweepableSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  generation: Schema.Int,
  path: Schema.String,
});

/** One generation the sweep may delete: its blob's path, and the row's id to delete once the blob is gone. */
export type SweepableAgentState = typeof SweepableSchema.Type;

const AgentKeySchema = Schema.Struct({ userId: Schema.String, agentId: Schema.String });

/** What a saver commits: the bundle it uploaded, the generation it started from, and the device it runs on. */
export interface AgentStateCommit {
  readonly agentId: string;
  /** The generation the saver restored or last committed; null where the agent had none. */
  readonly fromGeneration: number | null;
  readonly path: string;
  readonly bytes: number;
  /** Lowercase hex of the SHA-256 of the bundle's bytes as uploaded. */
  readonly sha256: string;
  /** The commit the bundle's work applies to; null for an agent with no repository. */
  readonly baseCommit: string | null;
  readonly deviceId: string;
}

/** The agent's row, where the account started it. */
const ownAgent = (userId: string, agentId: string) =>
  and(eq(agentTable.id, agentId), eq(agentTable.userId, userId));

/** A generation row joined to its agent's row, so a row of an agent gone joins nothing. */
const ofAgent = eq(agentStateGeneration.agentId, agentTable.id);

const standing = alias(agentStateGeneration, "standing");

/** The agent's newest generation inside a statement over `agent`; null where it has none. */
const newestOf = sql<number | null>`(${queryBuilder
  .select({ newest: max(standing.generation) })
  .from(standing)
  .where(eq(standing.agentId, agentTable.id))})`;

const findNewest = SqlSchema.findOneOption({
  Request: AgentKeySchema,
  Result: GenerationSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select(GENERATION_COLUMNS)
        .from(agentStateGeneration)
        .innerJoin(agentTable, ofAgent)
        .where(ownAgent(userId, agentId))
        .orderBy(desc(agentStateGeneration.generation))
        .limit(1),
    ),
});

const insertNext = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    fromGeneration: Schema.NullOr(Schema.Int),
    path: Schema.String,
    bytes: Schema.Int,
    sha256: Schema.String,
    baseCommit: Schema.NullOr(Schema.String),
    deviceId: Schema.String,
    now: Schema.Date,
  }),
  Result: GenerationSchema,
  execute: (commit) =>
    Database.use((db) =>
      db
        .insert(agentStateGeneration)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`gen_random_uuid()`.as("id"),
              agentId: sql<string>`${agentTable.id}`.as("agent_id"),
              conversationId: sql<string>`${agentTable.conversationId}`.as("conversation_id"),
              generation: sql<number>`coalesce(${newestOf}, 0) + 1`.as("generation"),
              path: sql<string>`${commit.path}::text`.as("path"),
              bytes: sql<number>`${commit.bytes}::integer`.as("bytes"),
              sha256: sql<string>`${commit.sha256}::text`.as("sha256"),
              baseCommit: sql<string | null>`${commit.baseCommit}::text`.as("base_commit"),
              deviceId: sql<string>`${agentTable.deviceId}`.as("device_id"),
              savedAt: sql<Date>`${commit.now}::timestamptz`.as("saved_at"),
            })
            .from(agentTable)
            .where(
              and(
                ownAgent(commit.userId, commit.agentId),
                eq(agentTable.deviceId, commit.deviceId),
                sql`${newestOf} is not distinct from ${commit.fromGeneration}::integer`,
              ),
            ),
        )
        // The second of two commits from one generation meets the first's row and writes nothing.
        .onConflictDoNothing({
          target: [agentStateGeneration.agentId, agentStateGeneration.generation],
        })
        .returning(GENERATION_COLUMNS),
    ),
});

const findPinnedAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...AgentKeySchema.fields, deviceId: Schema.String }),
  Result: Schema.Struct({ newest: Schema.NullOr(Schema.Int) }),
  execute: ({ userId, agentId, deviceId }) =>
    Database.use((db) =>
      db
        .select({ newest: newestOf })
        .from(agentTable)
        .where(and(ownAgent(userId, agentId), eq(agentTable.deviceId, deviceId))),
    ),
});

const findKey = SqlSchema.findOneOption({
  Request: AgentKeySchema,
  Result: SealedKeySchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          keyVersion: agentStateKey.keyVersion,
          sealedDataKey: agentStateKey.sealedDataKey,
          sealedKey: agentStateKey.sealedKey,
        })
        .from(agentStateKey)
        .innerJoin(agentTable, eq(agentTable.id, agentStateKey.agentId))
        .where(ownAgent(userId, agentId)),
    ),
});

const findEveryKey = SqlSchema.findAll({
  Request: Schema.Void,
  Result: KeyRowSchema,
  execute: () =>
    Database.use((db) =>
      db
        .select({
          userId: agentTable.userId,
          agentId: agentStateKey.agentId,
          keyVersion: agentStateKey.keyVersion,
          sealedDataKey: agentStateKey.sealedDataKey,
          sealedKey: agentStateKey.sealedKey,
        })
        .from(agentStateKey)
        .innerJoin(agentTable, eq(agentTable.id, agentStateKey.agentId))
        .orderBy(asc(agentStateKey.agentId)),
    ),
});

const rewrapKey = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    fromVersion: Schema.Int,
    sealedKey: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
  }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(agentStateKey)
        .set({ keyVersion: write.keyVersion, sealedDataKey: write.sealedDataKey })
        .where(
          and(
            eq(agentStateKey.agentId, write.agentId),
            eq(agentStateKey.keyVersion, write.fromVersion),
            eq(agentStateKey.sealedKey, write.sealedKey),
          ),
        )
        .returning({ agentId: agentStateKey.agentId }),
    ),
});

const insertKey = SqlSchema.void({
  Request: Schema.Struct({ ...AgentKeySchema.fields, ...SealedKeySchema.fields }),
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(agentStateKey)
        .select((qb) =>
          qb
            .select({
              agentId: sql<string>`${agentTable.id}`.as("agent_id"),
              keyVersion: sql<number>`${write.keyVersion}::integer`.as("key_version"),
              sealedDataKey: sql<string>`${write.sealedDataKey}::text`.as("sealed_data_key"),
              sealedKey: sql<string>`${write.sealedKey}::text`.as("sealed_key"),
              createdAt: sql<Date>`now()`.as("created_at"),
            })
            .from(agentTable)
            .where(ownAgent(write.userId, write.agentId)),
        )
        // Two first asks at once keep the first key, and both read it back.
        .onConflictDoNothing({ target: agentStateKey.agentId }),
    ),
});

/**
 * Whether the generation row may go: a newer generation of its agent
 * stands, its agent's transcript is gone, or it was committed by
 * `expiredBy`.
 */
function sweepable(expiredBy: Date): SQL | undefined {
  const superseded = exists(
    queryBuilder
      .select({ id: standing.id })
      .from(standing)
      .where(
        and(
          eq(standing.agentId, agentStateGeneration.agentId),
          gt(standing.generation, agentStateGeneration.generation),
        ),
      ),
  );
  const transcriptGone = notExists(
    queryBuilder
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, agentStateGeneration.conversationId)),
  );
  const expired = lte(agentStateGeneration.savedAt, expiredBy);
  return or(superseded, transcriptGone, expired);
}

const findSweepable = SqlSchema.findAll({
  Request: Schema.Struct({ expiredBy: Schema.Date, limit: Schema.Int }),
  Result: SweepableSchema,
  execute: ({ expiredBy, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: agentStateGeneration.id,
          agentId: agentStateGeneration.agentId,
          generation: agentStateGeneration.generation,
          path: agentStateGeneration.path,
        })
        .from(agentStateGeneration)
        .where(sweepable(expiredBy))
        .orderBy(asc(agentStateGeneration.savedAt), asc(agentStateGeneration.id))
        .limit(limit),
    ),
});

const deleteRows = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (ids) =>
    Database.use((db) =>
      db
        .delete(agentStateGeneration)
        .where(inArray(agentStateGeneration.id, ids))
        .returning({ id: agentStateGeneration.id }),
    ),
});

/** The agent's newest committed generation; none where it has none, or the account reaches no such agent. */
export function newestAgentState(
  userId: string,
  agentId: string,
): TaskStoreEffect<Option.Option<AgentStateGeneration>> {
  return findNewest({ userId, agentId });
}

/**
 * The agent's newest generation, null where it has none, where the account
 * started the agent and it is pinned to the device given; none otherwise,
 * so a device asks to save only its own agents.
 */
export function pinnedAgentState(
  userId: string,
  agentId: string,
  deviceId: string,
): TaskStoreEffect<Option.Option<{ readonly newest: number | null }>> {
  return findPinnedAgent({ userId, agentId, deviceId });
}

/**
 * Commits the saver's bundle as the agent's next generation, and answers
 * it, where the generation the saver started from is still the agent's
 * newest. Fails with `AgentStateStale` where a newer save landed since, and
 * with `AgentStateUnreachable` where the account reaches no such agent or
 * the agent is not pinned to the saver's device; neither writes anything.
 */
export function commitAgentState(
  userId: string,
  commit: AgentStateCommit,
  now: Date,
): Effect.Effect<
  AgentStateGeneration,
  AgentStateStale | AgentStateUnreachable | StoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const [committed] = yield* insertNext({ userId, ...commit, now });
    if (committed !== undefined) return committed;
    // Note that nothing was written, so the read only names why: a newer generation, or no agent of the saver's.
    const pinned = yield* findPinnedAgent({
      userId,
      agentId: commit.agentId,
      deviceId: commit.deviceId,
    });
    if (Option.isNone(pinned)) return yield* new AgentStateUnreachable();
    return yield* new AgentStateStale({ newest: pinned.value.newest });
  });
}

/**
 * The agent's state key, sealed, minted and kept where it has none: two
 * first asks at once keep one key, and both answer it. None where the
 * account reaches no such agent.
 */
export function ensureAgentStateKey(
  ring: KeyRing,
  userId: string,
  agentId: string,
): TaskStoreEffect<Option.Option<SealedAgentStateKey>> {
  return Effect.gen(function* () {
    const kept = yield* findKey({ userId, agentId });
    if (Option.isSome(kept)) return kept;
    const minted = yield* Effect.sync(() => mintAgentStateKey(ring, { userId, agentId }));
    yield* insertKey({ userId, agentId, ...minted });
    return yield* findKey({ userId, agentId });
  });
}

/** Every agent's sealed state key, with whose it is, across every account, for the rotation's rewrap. */
export function listEveryAgentStateKeyRow(): TaskStoreEffect<readonly AgentStateKeyRow[]> {
  return findEveryKey(undefined);
}

/**
 * Moves one key's row onto a new wrap of its data key, and answers whether
 * it did: not where the row was rewrapped or its agent deleted since it was read.
 */
export function rewrapAgentStateKeyRow(
  row: AgentStateKeyRow,
  rewrapped: SealedAgentStateKey,
): TaskStoreEffect<boolean> {
  return Effect.map(
    rewrapKey({
      agentId: row.agentId,
      fromVersion: row.keyVersion,
      sealedKey: row.sealedKey,
      keyVersion: rewrapped.keyVersion,
      sealedDataKey: rewrapped.sealedDataKey,
    }),
    (moved) => moved.length > 0,
  );
}

/**
 * The next generations the sweep may delete, across every account, at most
 * `limit`, the longest saved first: those superseded by a newer generation
 * of their agent, those of an agent whose transcript is gone, and those
 * committed at least `AGENT_STATE_RETENTION_MS` before `now`, the newest
 * included. The caller deletes each one's blob before its row.
 */
export function sweepableAgentStates(
  now: Date,
  limit: number,
): TaskStoreEffect<readonly SweepableAgentState[]> {
  const expiredBy = new Date(now.getTime() - AGENT_STATE_RETENTION_MS);
  return findSweepable({ expiredBy, limit });
}

/** Deletes the generations named, once the sweep deleted their blobs; answers how many rows went. */
export function deleteAgentStates(ids: readonly string[]): TaskStoreEffect<number> {
  if (ids.length === 0) return Effect.succeed(0);
  return Effect.map(deleteRows(ids), (rows) => rows.length);
}
