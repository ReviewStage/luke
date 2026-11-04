import { isWireUuid } from "@repo/features";
import { MEMORY_BOUNDS } from "@repo/features/memory-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, desc, eq, exists, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { member, organization, user } from "../schemas/auth.js";
import { memory } from "../schemas/memory.js";
import { InstantColumnSchema } from "./columns.js";
import { roleAmong, workspaceReachableBy } from "./workspace-store.js";

/**
 * memory-store.ts -- a workspace's memories, shared by its members, kept and corrected by its coding agents and read and forgotten from Settings.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * workspace, so no workspace reads, corrects, or forgets another's memory:
 * an id of another workspace's reads exactly as an id that names nothing.
 * Whether the caller is a member is the caller's to settle before it calls.
 * A keep or a correction runs under a lock on the workspace's own row, so
 * two at once — a retried call, or two members' calls — are serialized: the
 * same words kept twice stand once, the bound is counted once, and of two
 * corrections of one memory the later wins whole. A correction rewrites the
 * memory in place under its id and makes its words the corrector's, so the
 * workspace never holds the old words beside the new; where the new words
 * are already another memory's, the two become that one. Forgetting deletes
 * the row, and only for the member whose words it holds or one who manages
 * the workspace. A memory outlives the account whose words it holds, as a
 * workspace's git history outlives its committers: its member is then null.
 * The workspace's bound counts every memory, so a recall's read of one
 * workspace's rows stays bounded, and so does the live read Settings holds
 * (`workspaceMemoriesLiveStatement`), which answers every one of them.
 */

/** What a memory store operation answers: an effect over the ambient client. */
export type MemoryStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** What a keep or a correction came to. */
export const MEMORY_OUTCOME = {
  /** A new memory was kept. */
  KEPT: "kept",
  /** The same words already stood as a memory; it was touched, and nothing new was kept. */
  ALREADY_KEPT: "already_kept",
  /** The memory named was rewritten in place, or folded into one already holding the new words. */
  CORRECTED: "corrected",
  /** The memory named for correction is not the workspace's, or was forgotten; nothing was written. */
  NOT_FOUND: "not_found",
  /** The workspace holds as many memories as it may; nothing was written. */
  FULL: "full",
} as const;

/** What a forget came to. */
export const MEMORY_FORGET = {
  /** The memory is gone: forgotten now, or already gone before. */
  FORGOTTEN: "forgotten",
  /** The memory stands and the caller may not forget it; nothing was deleted. */
  NOT_PERMITTED: "not_permitted",
} as const;

export type MemoryForget = (typeof MEMORY_FORGET)[keyof typeof MEMORY_FORGET];

/** What a forget came to, and the transaction its delete committed in where it deleted a row; none where nothing was deleted. */
export interface MemoryForgot {
  readonly outcome: MemoryForget;
  readonly txid?: string;
}

type MemoryWritten =
  | typeof MEMORY_OUTCOME.KEPT
  | typeof MEMORY_OUTCOME.ALREADY_KEPT
  | typeof MEMORY_OUTCOME.CORRECTED;

/** One memory as the store holds it: its words and the member whose words they are, null once that account is gone. */
export interface StoredMemory {
  readonly id: string;
  readonly userId: string | null;
  readonly text: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type MemoryOutcome =
  | { readonly kind: MemoryWritten; readonly memory: StoredMemory }
  | { readonly kind: typeof MEMORY_OUTCOME.NOT_FOUND | typeof MEMORY_OUTCOME.FULL };

/** Who asks to forget: the member, and whether they own or administer the workspace. */
export interface MemoryForgetter {
  readonly userId: string;
  readonly manages: boolean;
}

const MemoryRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const ROW_COLUMNS = {
  id: memory.id,
  userId: memory.userId,
  text: memory.text,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
};

const MemoryKeySchema = Schema.Struct({ organizationId: Schema.String, id: Schema.String });

/** Every memory of the workspace, most recently kept or corrected first: what a keep counts and dedupes against under its lock, and what a read answers. */
const findMemories = SqlSchema.findAll({
  Request: Schema.String,
  Result: MemoryRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(memory)
        .where(eq(memory.organizationId, organizationId))
        .orderBy(desc(memory.updatedAt), desc(memory.createdAt)),
    ),
});

const findMemory = SqlSchema.findOneOption({
  Request: MemoryKeySchema,
  Result: MemoryRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(memory)
        .where(and(eq(memory.organizationId, key.organizationId), eq(memory.id, key.id))),
    ),
});

/** The workspace's row, held for the transaction, which is what serializes one workspace's keeps; nothing for a workspace gone. */
const lockWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update"),
    ),
});

const insertMemory = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    userId: Schema.String,
    text: Schema.String,
    now: Schema.Date,
  }),
  Result: MemoryRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(memory)
        .values({
          organizationId: write.organizationId,
          userId: write.userId,
          text: write.text,
          createdAt: write.now,
          updatedAt: write.now,
        })
        .returning(ROW_COLUMNS),
    ),
});

/** A memory's words written again, as the member they now belong to. */
const updateMemory = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...MemoryKeySchema.fields,
    userId: Schema.NullOr(Schema.String),
    text: Schema.String,
    now: Schema.Date,
  }),
  Result: MemoryRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .update(memory)
        .set({ text: write.text, userId: write.userId, updatedAt: write.now })
        .where(and(eq(memory.organizationId, write.organizationId), eq(memory.id, write.id)))
        .returning(ROW_COLUMNS),
    ),
});

/**
 * The id of the transaction a delete committed in, read in its own
 * `RETURNING`, so a reader following the memories waits for that
 * transaction to arrive before it confirms the forget.
 */
const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

/** A memory deleted, answering the transaction it was deleted in; none where no row was. */
const deleteMemory = SqlSchema.findAll({
  Request: MemoryKeySchema,
  Result: Schema.Struct({ txid: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(memory)
        .where(and(eq(memory.organizationId, key.organizationId), eq(memory.id, key.id)))
        .returning(TXID),
    ),
});

/** A row as the store answers it. */
function storedOf(row: typeof MemoryRowSchema.Type): StoredMemory {
  return {
    id: row.id,
    userId: row.userId,
    text: row.text,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** What a write came to, by the row it answered; a row the lock should have held but that is gone reads as not found. */
function outcomeOf(
  kind: MemoryWritten,
  row: Option.Option<typeof MemoryRowSchema.Type>,
): MemoryOutcome {
  return Option.match(row, {
    onNone: () => ({ kind: MEMORY_OUTCOME.NOT_FOUND }),
    onSome: (kept) => ({ kind, memory: storedOf(kept) }),
  });
}

/** Words as two memories are compared: case, spacing, and a closing stop do not tell them apart. */
function sameWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!]+$/u, "");
}

/** The workspace's memories, most recently kept or corrected first. */
export function listMemories(organizationId: string): MemoryStoreEffect<readonly StoredMemory[]> {
  return Effect.map(findMemories(organizationId), (rows) => rows.map(storedOf));
}

/**
 * Keeps one memory in the workspace as the member's words, or corrects the
 * one `replaces` names, and answers what that came to. The words are taken
 * as handed: the caller holds them to the bound and to what may be kept at
 * all. A new memory past the bound, or a correction of a memory the
 * workspace does not hold, writes nothing.
 */
export function rememberMemory(
  organizationId: string,
  userId: string,
  text: string,
  replaces: string | undefined,
): MemoryStoreEffect<MemoryOutcome> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const workspace = yield* lockWorkspace(organizationId);
        if (Option.isNone(workspace)) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;
        const every = (yield* findMemories(organizationId)).map(storedOf);
        const now = yield* DateTime.nowAsDate;
        const same = every.find((kept) => sameWords(kept.text) === sameWords(text));
        if (replaces !== undefined) {
          const target = every.find((kept) => kept.id === replaces.toLowerCase());
          if (target === undefined) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;
          // Note that a correction to words another memory already holds folds the two, because keeping both would hold one fact twice.
          if (same !== undefined && same.id !== target.id) {
            yield* deleteMemory({ organizationId, id: target.id });
          }
          const id = same?.id ?? target.id;
          const kept = yield* updateMemory({ organizationId, id, userId, text, now });
          return outcomeOf(MEMORY_OUTCOME.CORRECTED, kept);
        }
        if (same !== undefined) {
          // Note that the same words kept again stay the words of whoever kept them first.
          const kept = yield* updateMemory({
            organizationId,
            id: same.id,
            userId: same.userId,
            text,
            now,
          });
          return outcomeOf(MEMORY_OUTCOME.ALREADY_KEPT, kept);
        }
        if (every.length >= MEMORY_BOUNDS.MAX_MEMORIES) {
          return { kind: MEMORY_OUTCOME.FULL } as const;
        }
        const kept = yield* insertMemory({ organizationId, userId, text, now });
        return outcomeOf(MEMORY_OUTCOME.KEPT, kept);
      }),
    ),
  );
}

/**
 * Forgets one of the workspace's memories for good, where the forgetter may:
 * its words are theirs, or they manage the workspace, the only ones who may
 * forget a memory whose member's account is gone. An id that names none of
 * the workspace's memories, another workspace's included, forgets nothing
 * and answers forgotten with no transaction, so a forget retried after it
 * landed answers the same. One that deleted the row answers the transaction
 * it was deleted in beside it.
 */
export function forgetMemory(
  organizationId: string,
  id: string,
  by: MemoryForgetter,
): MemoryStoreEffect<MemoryForgot> {
  return Effect.gen(function* () {
    // Note that an id that is no UUID is never bound, because Postgres refuses any other text against a `uuid` column.
    if (!isWireUuid(id)) return { outcome: MEMORY_FORGET.FORGOTTEN };
    const found = yield* findMemory({ organizationId, id });
    if (Option.isNone(found)) return { outcome: MEMORY_FORGET.FORGOTTEN };
    if (found.value.userId !== by.userId && !by.manages) {
      return { outcome: MEMORY_FORGET.NOT_PERMITTED };
    }
    const [deleted] = yield* deleteMemory({ organizationId, id });
    return deleted === undefined
      ? { outcome: MEMORY_FORGET.FORGOTTEN }
      : { outcome: MEMORY_FORGET.FORGOTTEN, txid: deleted.txid };
  });
}

/**
 * The workspace's memories as one member's held read answers them: every
 * row of the workspace, while the reader is a member of it, each with the
 * name of the member whose words it holds, null once that account is gone,
 * and whether the reader may forget it: its words are theirs, or they own or
 * administer the workspace, as `forgetMemory`'s caller settles it. Every
 * column is under the key the wire reads it by (`@repo/features/memory-live`),
 * each instant as epoch milliseconds, and the order is the reader's to keep.
 * None where a statement names a value Realtime cannot carry.
 */
export function workspaceMemoriesLiveStatement(
  readerId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
  const manages = exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, readerId),
          roleAmong([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]),
        ),
      ),
  );
  // Note that a memory whose account is gone compares as unknown, so it reads forgettable only by those who manage it, as `forgetMemory` allows.
  const forgettable = sql<boolean>`coalesce(${or(eq(memory.userId, readerId), manages)}, false)`;
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            id: memory.id,
            text: memory.text,
            keeperId: memory.userId,
            keeperName: user.name,
            forgettable,
          },
          { createdAt: memory.createdAt, updatedAt: memory.updatedAt },
        ),
      )
      .from(memory)
      .leftJoin(user, eq(user.id, memory.userId))
      .where(
        and(
          eq(memory.organizationId, organizationId),
          workspaceReachableBy(readerId, organizationId),
        ),
      ),
  );
}
