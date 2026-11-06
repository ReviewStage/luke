import { Schema as EffectSchema } from "effect";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";
import { trimmedText } from "./text-schema.js";

export const MEMORY_BOUNDS = {
  MAX_CHARS: 400,
  MAX_MEMORIES: 1_000,
  MAX_QUERY_CHARS: 300,
} as const;

export const MEMORY_QUERY = {
  WORKSPACE_ID: "workspaceId",
  ID: "id",
  QUERY: "query",
} as const;

export const memoryIdSchema = wireUuidSchema;

const memorySummarySchema = EffectSchema.Struct({
  id: memoryIdSchema,
  text: EffectSchema.String,
  keptBy: EffectSchema.NullOr(memberRefSchema),
  forgettable: EffectSchema.Boolean,
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

export type MemorySummary = typeof memorySummarySchema.Type;

export const memoriesAnswerSchema = EffectSchema.Struct({
  memories: EffectSchema.Array(memorySummarySchema),
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type MemoriesAnswer = typeof memoriesAnswerSchema.Type;

export const MEMORY_SAVED = {
  KEPT: "kept",
  ALREADY_KEPT: "already_kept",
  CORRECTED: "corrected",
} as const;

export const memorySaveRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  text: trimmedText(MEMORY_BOUNDS.MAX_CHARS),
  replaces: EffectSchema.optionalKey(memoryIdSchema),
});

export type MemorySaveRequest = typeof memorySaveRequestSchema.Type;

export const memorySaveAnswerSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literals(Object.values(MEMORY_SAVED)),
  memory: memorySummarySchema,
});

export type MemorySaveAnswer = typeof memorySaveAnswerSchema.Type;

export const memorySearchQuerySchema = EffectSchema.optionalKey(
  EffectSchema.Trim.check(EffectSchema.isMaxLength(MEMORY_BOUNDS.MAX_QUERY_CHARS)),
);

export const memorySearchAnswerSchema = EffectSchema.Struct({
  memories: EffectSchema.Array(memorySummarySchema),
  total: countedNumber,
});

export type MemorySearchAnswer = typeof memorySearchAnswerSchema.Type;
