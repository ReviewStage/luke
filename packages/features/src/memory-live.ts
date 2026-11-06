import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { type MemorySummary, memoryIdSchema } from "./memory-wire.js";
import { countedNumber } from "./service-wire.js";

export const workspaceMemoriesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ memories: sealedLiveQuerySchema }),
});

export type WorkspaceMemoriesLiveAnswer = typeof workspaceMemoriesLiveAnswerSchema.Type;

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

export const workspaceMemoriesLiveRowsSchema = EffectSchema.Struct({
  memories: EffectSchema.Array(memoryLiveRowSchema),
});

function newestFirst(a: MemoryLiveRow, b: MemoryLiveRow): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1);
}

function keeperOf(row: MemoryLiveRow): MemorySummary["keptBy"] {
  return row.keeperId === null || row.keeperName === null
    ? null
    : { userId: row.keeperId, name: row.keeperName };
}

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
