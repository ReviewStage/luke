import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ParseOptions } from "effect/SchemaAST";
import { ACT_RESULT_STATUS, type ActResult } from "./act-result-vocabulary.js";
import {
  isRecord,
  type UnparsedWireValue,
  type WirePrimitive,
  type WireRecord,
  type WireValue,
} from "./json.js";
import { parseReleaseVersion } from "./release-version.js";
import type { WireBoundaryInput } from "./wire-boundary.js";

/** Decode options that reject keys outside a struct, matching the hand guards. */
export const STRICT_EXCESS_PROPERTY = { onExcessProperty: "error" } as const satisfies ParseOptions;

function plainRecord(value: unknown): value is WireRecord {
  return isRecord(value as UnparsedWireValue);
}

/** JSON primitive before field names are validated. */
export const WirePrimitiveSchema: Schema.Schema<WirePrimitive> = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
);

/** Plain object shell matching {@link isRecord}; nested values are not validated. */
export const PlainWireRecordSchema = Schema.Unknown.pipe(
  Schema.filter(plainRecord),
) as Schema.Schema<WireRecord>;

/** Any JSON value before field names are validated. */
export const WireValueSchema: Schema.Schema<WireValue> = Schema.suspend(() =>
  Schema.Union(
    WirePrimitiveSchema,
    Schema.Array(WireValueSchema),
    Schema.Record({ key: Schema.String, value: WireValueSchema }),
  ),
);

/** JSON or structured-clone input before wire guards run. */
export const StructuredCloneInputSchema: Schema.Schema<WireBoundaryInput> = Schema.suspend(() =>
  Schema.Union(
    Schema.Undefined,
    WirePrimitiveSchema,
    Schema.Array(StructuredCloneInputSchema),
    Schema.Record({ key: Schema.String, value: StructuredCloneInputSchema }),
  ),
);

/** Finite wire number matching {@link wholeNumber}'s numeric guard. */
export const FiniteWireNumberSchema: Schema.Schema<number> = Schema.Number.pipe(
  Schema.filter((value): value is number => Number.isFinite(value)),
);

/** Non-negative finite epoch milliseconds for counted events. */
export const NonNegativeFiniteTimestampSchema: Schema.Schema<number> = FiniteWireNumberSchema.pipe(
  Schema.filter((value): value is number => value >= 0),
);

/** Release version string matching {@link parseReleaseVersion}. */
export const ReleaseVersionSchema: Schema.Schema<string> = Schema.String.pipe(
  Schema.filter((value): value is string => parseReleaseVersion(value) !== undefined),
);

const ActResultAcceptedSchema = Schema.Struct({
  status: Schema.Literal(ACT_RESULT_STATUS.ACCEPTED),
});

const ActResultRejectedSchema = Schema.Struct({
  status: Schema.Literal(ACT_RESULT_STATUS.REJECTED),
  reason: Schema.String,
});

const ActResultUnsupportedSchema = Schema.Struct({
  status: Schema.Literal(ACT_RESULT_STATUS.UNSUPPORTED),
  reason: Schema.String,
});

/** Canonical act refusal vocabulary; excess fields are rejected. */
export const ActResultSchema: Schema.Schema<ActResult> = Schema.Union(
  ActResultAcceptedSchema,
  ActResultRejectedSchema,
  ActResultUnsupportedSchema,
);

/** Option decode for untrusted wire input. */
export function decodeUnknownOption<A, I>(
  schema: Schema.Schema<A, I>,
  value: unknown,
  options?: ParseOptions,
): Option.Option<A> {
  return Schema.decodeUnknownOption(schema, options)(value);
}

/** Undefined when the value does not satisfy the schema. */
export function decodeUnknown<A, I>(
  schema: Schema.Schema<A, I>,
  value: unknown,
  options?: ParseOptions,
): A | undefined {
  return Option.getOrUndefined(decodeUnknownOption(schema, value, options));
}

/** Strict act-result decode aligned with {@link isActResult}. */
export function decodeActResult(value: UnparsedWireValue): ActResult | undefined {
  return decodeUnknown(ActResultSchema, value, STRICT_EXCESS_PROPERTY);
}

/** Strict act-result membership aligned with {@link isActResult}. */
export function isDecodedActResult(value: UnparsedWireValue): value is ActResult {
  return decodeActResult(value) !== undefined;
}

export function decodeWireString(value: UnparsedWireValue): string | undefined {
  return decodeUnknown(Schema.String, value);
}

export function decodeWireNumber(value: UnparsedWireValue): number | undefined {
  return decodeUnknown(Schema.Number, value);
}

export function decodeRecord(value: UnparsedWireValue): WireRecord | undefined {
  return decodeUnknown(PlainWireRecordSchema, value);
}

export function decodeWireValue(value: UnparsedWireValue): WireValue | undefined {
  return decodeUnknown(WireValueSchema, value);
}

export function decodeStructuredCloneInput(value: unknown): WireBoundaryInput | undefined {
  return decodeUnknown(StructuredCloneInputSchema, value);
}

export function decodeText(value: UnparsedWireValue): string | undefined {
  const decoded = decodeWireString(value);
  if (decoded === undefined) return undefined;
  const normalized = decoded.trim();
  return normalized || undefined;
}

export function decodeWholeNumber(value: UnparsedWireValue): number | undefined {
  return decodeUnknown(FiniteWireNumberSchema, value);
}

export function decodeReleaseVersion(value: UnparsedWireValue): string | undefined {
  const decoded = decodeUnknown(ReleaseVersionSchema, value);
  return decoded?.trim();
}
