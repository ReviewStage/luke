const LOCALE = "en-US";

const COUNT = new Intl.NumberFormat(LOCALE);

const COMPACT = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

const KILOBYTE = 1_000;
const MEGABYTE = 1_000 * KILOBYTE;
const GIGABYTE = 1_000 * MEGABYTE;

const WHOLE_FROM = 10;

const WHOLE_DOLLARS_FROM = 1_000;

const CENTS = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DOLLARS = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const NO_SHARE = "—";

export function formatCount(value: number): string {
  return COUNT.format(value);
}

export function formatCompact(value: number): string {
  return COMPACT.format(value);
}

export function formatBytes(bytes: number): string {
  const size = Math.max(0, bytes);
  if (size < KILOBYTE) return `${Math.round(size)} B`;
  const [span, unit] =
    size < MEGABYTE
      ? ([KILOBYTE, "kB"] as const)
      : size < GIGABYTE
        ? ([MEGABYTE, "MB"] as const)
        : ([GIGABYTE, "GB"] as const);
  const figure = size / span;
  return `${figure < WHOLE_FROM ? figure.toFixed(1) : Math.round(figure)} ${unit}`;
}

export function formatExactBytes(bytes: number): string {
  return `${COUNT.format(bytes)} bytes`;
}

export function formatPercent(fraction: number | null, places = 0): string {
  if (fraction === null) return NO_SHARE;
  return `${(fraction * 100).toFixed(places)}%`;
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) return "<$0.01";
  return Math.abs(value) >= WHOLE_DOLLARS_FROM ? DOLLARS.format(value) : CENTS.format(value);
}
