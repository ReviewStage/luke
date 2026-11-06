import { Schema } from "effect";

type WirePrimitive = string | number | boolean | null;

export type WireRecord = { readonly [key: string]: WireValue };

export type WireValue = WirePrimitive | WireRecord | readonly WireValue[];

export type UnparsedWireValue = WireValue | undefined;

function isPlainWireRecordShape(value: unknown): value is WireRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isWireRecordValue(value: unknown): value is WireRecord {
  if (!isPlainWireRecordShape(value)) return false;
  return Object.values(value).every((entry) => readsWireValue(entry));
}

export const WireValueSchema: Schema.Codec<WireValue> = Schema.suspend(
  (): Schema.Codec<WireValue> =>
    Schema.Union([
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.Null,
      Schema.declare(isWireRecordValue),
      Schema.Array(WireValueSchema),
    ]),
);

const readsWireValue = Schema.is(WireValueSchema);

const readsWireString = Schema.is(Schema.String);

export function isWireString(value: UnparsedWireValue): value is string {
  return readsWireString(value);
}

const readsOptionalWireString = Schema.is(Schema.Union([Schema.String, Schema.Undefined]));

export function isOptionalWireString(value: UnparsedWireValue): value is string | undefined {
  return readsOptionalWireString(value);
}

const readsWireNumber = Schema.is(Schema.Number);

export function isWireNumber(value: UnparsedWireValue): value is number {
  return readsWireNumber(value);
}

const readsUnitLevel = Schema.is(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })));

export function isUnitLevel(value: UnparsedWireValue): value is number {
  return readsUnitLevel(value);
}

const readsWireBoolean = Schema.is(Schema.Boolean);

export function isWireBoolean(value: UnparsedWireValue): value is boolean {
  return readsWireBoolean(value);
}

export const WireRecordShapeSchema: Schema.Codec<WireRecord> =
  Schema.declare(isPlainWireRecordShape);

const readsWireRecordShape = Schema.is(WireRecordShapeSchema);

export function isRecord(value: UnparsedWireValue): value is WireRecord {
  return readsWireRecordShape(value);
}

export function isPlainRecord(value: WireBoundaryInput): value is WireBoundaryRecord {
  return isPlainWireRecordShape(value);
}

export function text(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

const readsInstant = Schema.is(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)));

export function isInstant(value: UnparsedWireValue): value is number {
  return readsInstant(value);
}

export function wholeNumber(value: UnparsedWireValue): number | undefined {
  if (!isWireNumber(value) || !Number.isFinite(value)) return undefined;
  return value;
}

export function wholeText(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/^\n+|\n+$/gu, "");
  return normalized || undefined;
}

export function valueFromJsonText(text: string): WireValue {
  try {
    return JSON.parse(text) as WireValue;
  } catch {
    return text;
  }
}

export function jsonRoundTrip(value: WireValue): WireValue;
export function jsonRoundTrip<Value>(value: Value): UnparsedWireValue;
export function jsonRoundTrip<Value>(value: Value): UnparsedWireValue {
  return JSON.parse(JSON.stringify(value)) as UnparsedWireValue;
}

export function recordFromJsonLine(line: string): WireRecord | undefined {
  const parsed = valueFromJsonText(line);
  return isRecord(parsed) ? parsed : undefined;
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

type ResolvedNumericOptions<K extends string> = { readonly [P in K]: number };

export function resolveOptions<K extends string>(
  options: { readonly [P in K]?: number },
  defaults: { readonly [P in K]: number },
  bounds: {
    readonly positive?: readonly K[];
    readonly nonNegative?: readonly K[];
  },
): ResolvedNumericOptions<K> {
  let resolved = { ...defaults };
  for (const key of bounds.positive ?? []) {
    resolved = {
      ...resolved,
      [key]: positiveInteger(options[key], defaults[key]),
    };
  }
  for (const key of bounds.nonNegative ?? []) {
    resolved = {
      ...resolved,
      [key]: nonNegativeNumber(options[key], defaults[key]),
    };
  }
  return resolved;
}

export type WireBoundaryInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly WireBoundaryInput[]
  | WireBoundaryRecord;

type WireBoundaryRecord = { readonly [key: string]: WireBoundaryInput };

export function unparsedWire(value: WireBoundaryInput): UnparsedWireValue {
  return value as UnparsedWireValue;
}

export function wireRecord(value: UnparsedWireValue): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UPGRADE_REQUIRED: 426,
  TOO_MANY_REQUESTS: 429,
} as const;

export function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
