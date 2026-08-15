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
    if (typeof fallback !== "number") return;
    resolved[key] =
      kind === "positive"
        ? positiveInteger(options[key], fallback)
        : nonNegativeNumber(options[key], fallback);
  };
  for (const key of bounds.positive ?? []) assign(key, "positive");
  for (const key of bounds.nonNegative ?? []) assign(key, "nonNegative");
  return resolved;
}
