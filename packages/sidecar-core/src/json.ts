/**
 * Defensive readers for values a provider, API, or model may have produced
 * as JSON. A missing or mistyped field is undefined, never a throw, so one
 * bad record cannot fail an observation.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: Json };
export type Json = JsonPrimitive | readonly Json[] | JsonObject;

export function isJsonString(value: Json): value is string {
  return typeof value === "string";
}

export function isJsonNumber(value: Json): value is number {
  return typeof value === "number";
}

export function isJsonObject(value: Json): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isRecord(value: Json): value is JsonObject {
  return isJsonObject(value);
}

export function parseJson(text: string): Json | undefined {
  try {
    // SAFETY: JSON.parse returns a JSON value; the readers below reject
    // mistyped fields rather than trusting the tree's layout.
    return JSON.parse(text) as Json;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function text(value: Json): string | undefined {
  const normalized = isJsonString(value) ? value.trim() : "";
  return normalized || undefined;
}

export function wholeNumber(value: Json): number | undefined {
  return isJsonNumber(value) && Number.isFinite(value) ? value : undefined;
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

export function recordFromJsonLine(line: string): JsonObject | undefined {
  const parsed = parseJson(line);
  return parsed !== undefined && isJsonObject(parsed) ? parsed : undefined;
}

export function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

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
): { [P in K]: number } {
  const resolved: { [P in K]: number } = { ...defaults };
  const assign = (key: K, kind: "positive" | "nonNegative"): void => {
    const fallback = defaults[key];
    if (!isJsonNumber(fallback)) return;
    resolved[key] =
      kind === "positive"
        ? positiveInteger(options[key], fallback)
        : nonNegativeNumber(options[key], fallback);
  };
  for (const key of bounds.positive ?? []) assign(key, "positive");
  for (const key of bounds.nonNegative ?? []) assign(key, "nonNegative");
  return resolved;
}
