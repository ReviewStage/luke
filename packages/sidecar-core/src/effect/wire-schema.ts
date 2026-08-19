import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  isRecord,
  type UnparsedWireValue,
  type WirePrimitive,
  type WireRecord,
  type WireValue,
} from "../json.js";

/** JSON primitive before field names are validated. */
export const WirePrimitiveSchema: Schema.Schema<WirePrimitive> = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
);

/** JSON object whose nested values satisfy {@link WireValueSchema}. */
export const WireRecordSchema: Schema.Schema<WireRecord> = Schema.suspend(() =>
  Schema.Record({
    key: Schema.String,
    value: WireValueSchema,
  }),
);

/** Any JSON value before field names are validated. */
export const WireValueSchema: Schema.Schema<WireValue> = Schema.suspend(() =>
  Schema.Union(WirePrimitiveSchema, WireRecordSchema, Schema.Array(WireValueSchema)),
);

// SAFETY: the filter narrows unknown wire input to plain records before decodeRecord uses them.
export const PlainWireRecordSchema: Schema.Schema<WireRecord> = Schema.Unknown.pipe(
  Schema.filter((value: unknown): value is WireRecord => isRecord(value as UnparsedWireValue)),
) as Schema.Schema<WireRecord>;

/** Finite wire number matching {@link wholeNumber}'s numeric guard. */
export const FiniteWireNumberSchema: Schema.Schema<number> = Schema.Number.pipe(
  Schema.filter((value: number): value is number => Number.isFinite(value)),
);

export function decodeUnknownOption<A>(
  schema: Schema.Schema<A>,
  value: UnparsedWireValue,
): Option.Option<A> {
  return Schema.decodeUnknownOption(schema)(value);
}

export function decodeUnknown<A>(
  schema: Schema.Schema<A>,
  value: UnparsedWireValue,
): A | undefined {
  return Option.getOrUndefined(decodeUnknownOption(schema, value));
}

export function decodeWireString(value: UnparsedWireValue): string | undefined {
  return decodeUnknown(Schema.String, value);
}

export function decodeWireStringOption(value: UnparsedWireValue): Option.Option<string> {
  return decodeUnknownOption(Schema.String, value);
}

export function decodeWireNumber(value: UnparsedWireValue): number | undefined {
  return decodeUnknown(Schema.Number, value);
}

export function decodeWireNumberOption(value: UnparsedWireValue): Option.Option<number> {
  return decodeUnknownOption(Schema.Number, value);
}

export function decodeRecord(value: UnparsedWireValue): WireRecord | undefined {
  return decodeUnknown(PlainWireRecordSchema, value);
}

export function decodeRecordOption(value: UnparsedWireValue): Option.Option<WireRecord> {
  return decodeUnknownOption(PlainWireRecordSchema, value);
}

export function decodeWireValue(value: UnparsedWireValue): WireValue | undefined {
  return decodeUnknown(WireValueSchema, value);
}

export function decodeWireValueOption(value: UnparsedWireValue): Option.Option<WireValue> {
  return decodeUnknownOption(WireValueSchema, value);
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

export function decodeOneLine(
  value: string | undefined,
  maximumLength: number,
): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maximumLength
    ? `${normalized.slice(0, maximumLength - 1).trimEnd()}…`
    : normalized;
}

export function decodeRecordFromJsonLine(line: string): WireRecord | undefined {
  try {
    // SAFETY: JSON.parse returns a runtime value; decodeRecord validates the object contract.
    const parsed = JSON.parse(line) as UnparsedWireValue;
    return decodeRecord(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function decodePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function decodeNonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}
