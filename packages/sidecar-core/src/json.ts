/**
 * Defensive readers for values a provider, API, or model may have shaped
 * differently than this build expects. A missing or mistyped field is
 * undefined, never a throw, so one bad record cannot fail an observation.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

export function recordFromJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
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

/**
 * Bounds a bag of numeric constructor options against their defaults. Each
 * listed key is read from `options` and clamped by kind — a missing, infinite,
 * or out-of-range value keeps the default — so every adapter constructor does
 * not restate the same {@link positiveInteger} / {@link nonNegativeNumber}
 * calls.
 */
export function resolveOptions<D extends Record<string, number>>(
  options: { readonly [K in keyof D]?: number },
  defaults: D,
  bounds: {
    readonly positive?: readonly (keyof D)[];
    readonly nonNegative?: readonly (keyof D)[];
  },
): D {
  const resolved = { ...defaults };
  for (const key of bounds.positive ?? []) {
    resolved[key] = positiveInteger(options[key], defaults[key]);
  }
  for (const key of bounds.nonNegative ?? []) {
    resolved[key] = nonNegativeNumber(options[key], defaults[key]);
  }
  return resolved;
}
