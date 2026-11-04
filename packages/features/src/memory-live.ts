import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { type MemorySummary, memoryIdSchema } from "./memory-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * memory-live.ts -- one workspace's memories as the host follows them over the service's held poll: the statement the service answers, the rows it delivers, and the memories as Settings › Memory draws them.
 *
 * The service answers one statement, every memory of the workspace while the
 * reader is a member of it, each with the name of the member whose words it
 * holds and whether the reader may forget it, both worked out in the
 * statement itself. The rows come in no order, so the reader orders them as
 * the memories read answers them (`memory-wire.ts`): most recently kept or
 * corrected first.
 */

/** One workspace's memories sealed for following: the address, and one statement. The service answers `not-found` for a workspace the account is no member of. */
export const workspaceMemoriesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ memories: sealedLiveQuerySchema }),
});

export type WorkspaceMemoriesLiveAnswer = typeof workspaceMemoriesLiveAnswerSchema.Type;

/** One memory as the statement delivers it: its keeper's id and name, each null once that account is gone. */
const memoryLiveRowSchema = EffectSchema.Struct({
  id: memoryIdSchema,
  text: EffectSchema.String,
  keeperId: EffectSchema.NullOr(EffectSchema.String),
  keeperName: EffectSchema.NullOr(EffectSchema.String),
  forgettable: EffectSchema.Boolean,
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

export type MemoryLiveRow = typeof memoryLiveRowSchema.Type;

/** A workspace's memories as Realtime delivers them, decoded at the boundary before anything reads them. */
export const workspaceMemoriesLiveRowsSchema = EffectSchema.Struct({
  memories: EffectSchema.Array(memoryLiveRowSchema),
});

/** Most recently kept or corrected first, then the newest kept, then by id, so two alike keep one order. */
function newestFirst(a: MemoryLiveRow, b: MemoryLiveRow): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1);
}

/** The member whose words a row holds, as the reader is told; nobody for an account that is gone. */
function keeperOf(row: MemoryLiveRow): MemorySummary["keptBy"] {
  return row.keeperId === null || row.keeperName === null
    ? null
    : { userId: row.keeperId, name: row.keeperName };
}

/** A workspace's memories as the held read answers them, most recently kept or corrected first. */
export function memoriesOfLiveRows(rows: readonly MemoryLiveRow[]): readonly MemorySummary[] {
  return rows.toSorted(newestFirst).map((row) => ({
    id: row.id,
    text: row.text,
    keptBy: keeperOf(row),
    forgettable: row.forgettable,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
