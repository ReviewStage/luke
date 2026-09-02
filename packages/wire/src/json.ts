/**
 * Defensive readers for values a provider, API, or model may have shaped
 * differently than this build expects. A missing or mistyped field is
 * undefined, never a throw, so one bad record cannot fail an observation.
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

function runtimeTag(value: UnparsedWireValue): string {
  return Object.prototype.toString.call(value);
}

/** Narrows a wire value to string without trusting a runtime typeof check. */
export function isWireString(value: UnparsedWireValue): value is string {
  return runtimeTag(value) === "[object String]";
}

/** Narrows a wire value to number without trusting a runtime typeof check. */
export function isWireNumber(value: UnparsedWireValue): value is number {
  return runtimeTag(value) === "[object Number]";
}

/** Narrows a wire value to boolean without trusting a runtime typeof check. */
export function isWireBoolean(value: UnparsedWireValue): value is boolean {
  return runtimeTag(value) === "[object Boolean]";
}

export function isRecord(value: UnparsedWireValue): value is WireRecord {
  if (value === null || value === undefined) return false;
  if (runtimeTag(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function text(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
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
    const fallback = defaults[key];
    if (!isWireNumber(fallback)) continue;
    resolved = {
      ...resolved,
      [key]: positiveInteger(options[key], fallback),
    };
  }
  for (const key of bounds.nonNegative ?? []) {
    const fallback = defaults[key];
    if (!isWireNumber(fallback)) continue;
    resolved = {
      ...resolved,
      [key]: nonNegativeNumber(options[key], fallback),
    };
  }
  return resolved;
}
