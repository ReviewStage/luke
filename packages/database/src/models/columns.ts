import { agentArchiverSchema } from "@repo/features/agent-wire";
import { Schema, SchemaTransformation } from "effect";

export function nullable<Value>(value: Value | undefined): Value | null {
  return value === undefined ? null : value;
}

export function optionalField<Value>(name: string, value: Value | null): Record<string, Value> {
  return value === null ? {} : { [name]: value };
}

export const NumberFromBigIntColumn = Schema.BigInt.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transform({ decode: Number, encode: BigInt }),
  ),
);

export const EpochMillisColumnSchema = Schema.Union([
  Schema.Number,
  Schema.NumberFromString,
  NumberFromBigIntColumn,
]);

export const InstantColumnSchema = Schema.Union([Schema.DateFromMillis, Schema.Date]);

export const ArchivedByColumnSchema = Schema.NullOr(
  Schema.Struct({
    by: agentArchiverSchema,
    userId: Schema.String,
    agentId: Schema.optionalKey(Schema.String),
    agentName: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String),
    withTask: Schema.optionalKey(Schema.Boolean),
  }),
);

const UsageCountsFields = {
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
  cacheWriteTokens: Schema.optionalKey(Schema.Number),
};

export const TurnUsageColumnSchema = Schema.Struct({
  ...UsageCountsFields,
  byModel: Schema.optionalKey(
    Schema.Array(Schema.Struct({ model: Schema.String, ...UsageCountsFields })),
  ),
});
