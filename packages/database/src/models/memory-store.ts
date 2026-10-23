import { isWireUuid } from "@luke/features";
import { MEMORY_BOUNDS } from "@luke/features/memory-wire";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { organization } from "../schemas/auth.js";
import { memory } from "../schemas/memory.js";
import { InstantColumnSchema } from "./columns.js";

/**
 * memory-store.ts -- a workspace's memories, shared or private to one member, kept and corrected by its coding agents and read and forgotten from Settings.
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
 *
 * A private memory is one member's alone (`private_to`): only that member
 * reads, corrects, and forgets it, and to everyone else its id reads exactly
 * as an id that names nothing, a manager included. The same words kept twice
 * stand once only within one visibility, so a private memory never folds into
 * a shared one or the reverse, and a correction keeps the visibility of the
 * memory it corrects. The workspace's bound counts every memory, private ones
 * included, so a recall's read of one workspace's rows stays bounded.
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

type MemoryWritten =
  | typeof MEMORY_OUTCOME.KEPT
  | typeof MEMORY_OUTCOME.ALREADY_KEPT
  | typeof MEMORY_OUTCOME.CORRECTED;

/** One memory as the store holds it: its words and the member whose words they are, null once that account is gone. */
export interface StoredMemory {
  readonly id: string;
  readonly userId: string | null;
  readonly text: string;
  /** The one member who reads it, null for a memory the workspace shares. */
  readonly privateTo: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type MemoryOutcome =
  | { readonly kind: MemoryWritten; readonly memory: StoredMemory }
  | { readonly kind: typeof MEMORY_OUTCOME.NOT_FOUND | typeof MEMORY_OUTCOME.FULL };

/** How a keep stands to private memories: whether it keeps one, and whether the keeper's agent reaches private memories at all, which only the member's operator does. */
export interface MemoryKeep {
  readonly privately?: boolean;
  readonly readsPrivate?: boolean;
}

/** Who asks to forget: the member, and whether they own or administer the workspace. */
export interface MemoryForgetter {
  readonly userId: string;
  readonly manages: boolean;
}

const MemoryRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.NullOr(Schema.String),
  text: Schema.String,
  privateTo: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const ROW_COLUMNS = {
  id: memory.id,
  userId: memory.userId,
  text: memory.text,
  privateTo: memory.privateTo,
  createdAt: memory.createdAt,
  updatedAt: memory.updatedAt,
};

const MemoryKeySchema = Schema.Struct({ organizationId: Schema.String, id: Schema.String });

/** Every memory of the workspace, private ones included: what a keep counts and dedupes against under its lock. */
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

/** The workspace's memories one member reads: the shared ones and their own private ones, or the shared ones alone for no reader. */
const findReadableMemories = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, readerId: Schema.NullOr(Schema.String) }),
  Result: MemoryRowSchema,
  execute: (read) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(memory)
        .where(
          and(
            eq(memory.organizationId, read.organizationId),
            read.readerId === null
              ? isNull(memory.privateTo)
              : or(isNull(memory.privateTo), eq(memory.privateTo, read.readerId)),
          ),
        )
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
    privateTo: Schema.NullOr(Schema.String),
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
          privateTo: write.privateTo,
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

const deleteMemory = SqlSchema.void({
  Request: MemoryKeySchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(memory)
        .where(and(eq(memory.organizationId, key.organizationId), eq(memory.id, key.id))),
    ),
});

/** A row as the store answers it. */
function storedOf(row: typeof MemoryRowSchema.Type): StoredMemory {
  return {
    id: row.id,
    userId: row.userId,
    text: row.text,
    privateTo: row.privateTo,
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

/** Whether a member reads a memory: it is shared, or private to them. */
function readableBy(kept: StoredMemory, readerId: string): boolean {
  return kept.privateTo === null || kept.privateTo === readerId;
}

/**
 * The workspace's memories one member reads, the shared and their own
 * private ones, most recently kept or corrected first; with no reader, the
 * shared ones alone, for a read whose answer teammates may see.
 */
export function listMemories(
  organizationId: string,
  readerId: string | null,
): MemoryStoreEffect<readonly StoredMemory[]> {
  return Effect.map(findReadableMemories({ organizationId, readerId }), (rows) =>
    rows.map(storedOf),
  );
}

/**
 * Keeps one memory in the workspace as the member's words, private to them
 * where `keep.privately`, or corrects the one `replaces` names, and answers
 * what that came to. The words are taken as handed: the caller holds them to
 * the bound and to what may be kept at all. A new memory past the bound, or a
 * correction of a memory the keeper does not read, writes nothing; a keeper
 * whose agent reaches no private memory (`keep.readsPrivate` false) reads
 * none, even its own member's.
 */
export function rememberMemory(
  organizationId: string,
  userId: string,
  text: string,
  replaces: string | undefined,
  keep: MemoryKeep = {},
): MemoryStoreEffect<MemoryOutcome> {
  const { privately = false, readsPrivate = true } = keep;
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const workspace = yield* lockWorkspace(organizationId);
        if (Option.isNone(workspace)) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;
        const every = (yield* findMemories(organizationId)).map(storedOf);
        const readable = every.filter((kept) =>
          readsPrivate ? readableBy(kept, userId) : kept.privateTo === null,
        );
        const now = yield* DateTime.nowAsDate;
        // Note that words are the same only within one visibility, because folding would publish a private memory or hide a shared one.
        const sameIn = (privateTo: string | null) =>
          readable.find(
            (kept) => kept.privateTo === privateTo && sameWords(kept.text) === sameWords(text),
          );
        if (replaces !== undefined) {
          const target = readable.find((kept) => kept.id === replaces.toLowerCase());
          if (target === undefined) return { kind: MEMORY_OUTCOME.NOT_FOUND } as const;
          const same = sameIn(target.privateTo);
          // Note that a correction to words another memory already holds folds the two, because keeping both would hold one fact twice.
          if (same !== undefined && same.id !== target.id) {
            yield* deleteMemory({ organizationId, id: target.id });
          }
          const id = same?.id ?? target.id;
          const kept = yield* updateMemory({ organizationId, id, userId, text, now });
          return outcomeOf(MEMORY_OUTCOME.CORRECTED, kept);
        }
        const privateTo = privately ? userId : null;
        const same = sameIn(privateTo);
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
        const kept = yield* insertMemory({ organizationId, userId, text, privateTo, now });
        return outcomeOf(MEMORY_OUTCOME.KEPT, kept);
      }),
    ),
  );
}

/**
 * Forgets one of the workspace's memories for good, where the forgetter may:
 * its words are theirs, or they manage the workspace, the only ones who may
 * forget a memory whose member's account is gone. A private memory only its
 * member forgets. An id that names none of the memories the forgetter reads,
 * another workspace's or a teammate's private one included, forgets nothing
 * and answers forgotten, so a forget retried after it landed answers the same.
 */
export function forgetMemory(
  organizationId: string,
  id: string,
  by: MemoryForgetter,
): MemoryStoreEffect<MemoryForget> {
  return Effect.gen(function* () {
    // Note that an id that is no UUID is never bound, because Postgres refuses any other text against a `uuid` column.
    if (!isWireUuid(id)) return MEMORY_FORGET.FORGOTTEN;
    const found = yield* findMemory({ organizationId, id });
    if (Option.isNone(found)) return MEMORY_FORGET.FORGOTTEN;
    const kept = storedOf(found.value);
    if (!readableBy(kept, by.userId)) return MEMORY_FORGET.FORGOTTEN;
    const own = kept.userId === by.userId || kept.privateTo === by.userId;
    if (!own && !by.manages) return MEMORY_FORGET.NOT_PERMITTED;
    yield* deleteMemory({ organizationId, id });
    return MEMORY_FORGET.FORGOTTEN;
  });
}
