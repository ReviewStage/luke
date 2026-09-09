/**
 * The wire boundary: the values that arrive from outside this build, the
 * defensive readers that decode them, and the HTTP vocabulary the readers
 * answer for. A missing or mistyped field is undefined, never a throw, so one
 * bad record cannot fail an observation. The HTTP statuses and the injected
 * fetch sit here rather than with the adapters that read them, so the fake
 * that speaks this vocabulary is reachable without depending on every
 * provider.
 */

/** A JSON primitive before this build has validated field names. */
export type WirePrimitive = string | number | boolean | null;

/** A JSON object before this build has validated field names. */
export type WireRecord = { readonly [key: string]: WireValue };

/** Any value JSON can carry before this build has validated field names. */
export type WireValue = WirePrimitive | WireRecord | readonly WireValue[];

/**
 * Anything that may arrive from outside this package before parsing.
 * True I/O boundaries pass values here; every function below is the parser.
 */
export type UnparsedWireValue = WireValue | undefined;

/**
 * Narrows a wire value to string. `typeof` rather than the runtime tag,
 * because `Object.prototype.toString.call(new String("x"))` is
 * `"[object String]"`: a boxed primitive arriving over structured clone would
 * satisfy the tag and then fail every string operation the caller believes it
 * has narrowed to.
 */
export function isWireString(value: UnparsedWireValue): value is string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard is the wire boundary's own decoder; every other module narrows by calling it.
  return typeof value === "string";
}

/** An optional wire string: present as a string, or absent. */
export function isOptionalWireString(value: UnparsedWireValue): value is string | undefined {
  return value === undefined || isWireString(value);
}

/** Narrows a wire value to number; `typeof` for the reason {@link isWireString} gives. */
export function isWireNumber(value: UnparsedWireValue): value is number {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard is the wire boundary's own decoder; every other module narrows by calling it.
  return typeof value === "number";
}

/**
 * A level a fraction of full, as every volume and pace on the wire is said:
 * finite and within 0 to 1 inclusive, so a bare {@link isWireNumber} cannot
 * pass an infinity or a value outside the scale into something that
 * multiplies by it.
 */
export function isUnitLevel(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** A non-empty array of wire numbers, or nothing; `width` pins the length when the caller knows it. */
export function numberVector(value: UnparsedWireValue, width?: number): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (width !== undefined && value.length !== width) return undefined;
  const vector: number[] = [];
  for (const component of value) {
    if (!isWireNumber(component)) return undefined;
    vector.push(component);
  }
  return vector;
}

/** Vectors of one width: the width given, or the first vector's when none is. */
export function numberVectors(
  value: UnparsedWireValue | readonly UnparsedWireValue[],
  width?: number,
): number[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const vectors: number[][] = [];
  let expected = width;
  for (const entry of value) {
    const vector = numberVector(entry, expected);
    if (!vector) return undefined;
    expected = vector.length;
    vectors.push(vector);
  }
  return vectors;
}

/** Narrows a wire value to boolean; `typeof` for the reason {@link isWireString} gives. */
export function isWireBoolean(value: UnparsedWireValue): value is boolean {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard is the wire boundary's own decoder; every other module narrows by calling it.
  return typeof value === "boolean";
}

export function isRecord(value: UnparsedWireValue): value is WireRecord {
  if (value === null || value === undefined) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function text(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/**
 * An instant on the wire: epoch milliseconds, finite and never before the
 * epoch, so a record claiming a negative or infinite time reads as no time at
 * all rather than as an arithmetic hazard downstream.
 */
export function isInstant(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0;
}

export function wholeNumber(value: UnparsedWireValue): number | undefined {
  if (!isWireNumber(value) || !Number.isFinite(value)) return undefined;
  return value;
}

/**
 * Collapses the newlines and runs of spaces a one-line row cannot show. A
 * value longer than the bound is cut with an ellipsis that takes one
 * character of that bound, so two callers cannot truncate the same phrase
 * two different ways.
 */
export function oneLine(value: string | undefined, maximumLength: number): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maximumLength
    ? `${normalized.slice(0, maximumLength - 1).trimEnd()}…`
    : normalized;
}

/**
 * Trims a field whose whole words are the point of reporting it, keeping the
 * line breaks they were written with: an agent's parting words are Markdown
 * as often as not, and a heading, a list, or a fenced block exists only
 * across lines. Line endings settle to one form, trailing space leaves each
 * line, a run of blank lines closes to one, and blank lines at either end
 * go, while a first line's own indent stays, because indented code or a
 * nested item may be where the words begin. That is all the structure
 * Markdown reads; a surface that draws one line collapses the rest itself.
 */
export function wholeText(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/^\n+|\n+$/gu, "");
  return normalized || undefined;
}

export function recordFromJsonLine(line: string): WireRecord | undefined {
  try {
    // SAFETY: JSON.parse returns a runtime value; isRecord validates the object contract.
    const parsed = JSON.parse(line) as UnparsedWireValue;
    return isRecord(parsed) ? parsed : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/** Constructor options after defaults are merged and bounds are applied. */
export type ResolvedNumericOptions<K extends string> = { readonly [P in K]: number };

/**
 * Bounds a bag of numeric constructor options against their defaults. Each
 * listed key is read from `options` and clamped by kind — a missing, infinite,
 * or out-of-range value keeps the default — so every adapter constructor does
 * not restate the same {@link positiveInteger} / {@link nonNegativeNumber}
 * calls.
 */
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

/** JSON or structured-clone input before wire guards run. */
export type WireBoundaryInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly WireBoundaryInput[]
  | { readonly [key: string]: WireBoundaryInput };

/** Accepts JSON or structured-clone input before wire guards run. */
export function unparsedWire(value: WireBoundaryInput): UnparsedWireValue {
  // SAFETY: WireBoundaryInput is the structured-clone shape; UnparsedWireValue is the same boundary one step in.
  return value as UnparsedWireValue;
}

/** Narrows JSON or IPC input before field guards run. */
export function wireRecord(value: UnparsedWireValue): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}

/** The statuses this build branches on at the HTTP boundary. */
export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
} as const;

/** The fetch a caller is given, so a test can answer for the network. */
export type CloudFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * A base address with no trailing separator, so a path joined to it cannot
 * produce a doubled slash the upstream reads as a different route.
 */
export function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
