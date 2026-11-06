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

export type MemoryStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

export const MEMORY_OUTCOME = {
  KEPT: "kept",
  ALREADY_KEPT: "already_kept",
  CORRECTED: "corrected",
  NOT_FOUND: "not_found",
  FULL: "full",
} as const;

export const MEMORY_FORGET = {
  FORGOTTEN: "forgotten",
  NOT_PERMITTED: "not_permitted",
} as const;

export type MemoryForget = (typeof MEMORY_FORGET)[keyof typeof MEMORY_FORGET];

export interface MemoryForgot {
  readonly outcome: MemoryForget;
  readonly txid?: string;
}

type MemoryWritten =
  | typeof MEMORY_OUTCOME.KEPT
  | typeof MEMORY_OUTCOME.ALREADY_KEPT
  | typeof MEMORY_OUTCOME.CORRECTED;

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

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

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

function storedOf(row: typeof MemoryRowSchema.Type): StoredMemory {
  return {
    id: row.id,
    userId: row.userId,
    text: row.text,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function outcomeOf(
  kind: MemoryWritten,
  row: Option.Option<typeof MemoryRowSchema.Type>,
): MemoryOutcome {
  return Option.match(row, {
    onNone: () => ({ kind: MEMORY_OUTCOME.NOT_FOUND }),
    onSome: (kept) => ({ kind, memory: storedOf(kept) }),
  });
}

function sameWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!]+$/u, "");
}

export function listMemories(organizationId: string): MemoryStoreEffect<readonly StoredMemory[]> {
  return Effect.map(findMemories(organizationId), (rows) => rows.map(storedOf));
}

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
          if (same !== undefined && same.id !== target.id) {
            yield* deleteMemory({ organizationId, id: target.id });
          }
          const id = same?.id ?? target.id;
          const kept = yield* updateMemory({ organizationId, id, userId, text, now });
          return outcomeOf(MEMORY_OUTCOME.CORRECTED, kept);
        }
        if (same !== undefined) {
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

export function forgetMemory(
  organizationId: string,
  id: string,
  by: MemoryForgetter,
): MemoryStoreEffect<MemoryForgot> {
  return Effect.gen(function* () {
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
