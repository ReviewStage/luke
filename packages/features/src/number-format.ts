/**
 * number-format.ts -- every app's one way of saying how many and how big, with no DOM: a count, a compact count, a size in bytes, a percentage, and dollars.
 *
 * Every figure is set in US English whatever the Mac's own region, as the
 * words around it are (`time-format.ts` says the same of its clocks), so a
 * count reads "1,234" and a size "48 kB" in every window. A compact count
 * is an `Intl` one: "812", "12K", "1.9M". A size counts in thousands and
 * spells its units as SI does for a thousand: "kB", "MB", "GB".
 */

/** The locale every figure is said in, the window's words being English. */
const LOCALE = "en-US";

/** A count as every list says it, grouped by thousands: "1,234". */
const COUNT = new Intl.NumberFormat(LOCALE);

/** A count drawn short, to one place: "12.3K", and "12K" where the place would be a zero. */
const COMPACT = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

const KILOBYTE = 1_000;
const MEGABYTE = 1_000 * KILOBYTE;
const GIGABYTE = 1_000 * MEGABYTE;

/** From here a size's figure drops its decimal place: it is noise beside the whole figures. */
const WHOLE_FROM = 10;

/** From here a dollar figure drops its cents: they are noise beside the thousands. */
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

/** What stands where a figure has no whole to be a share of. */
const NO_SHARE = "—";

/** A count grouped by thousands: "1,234". */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** A large count drawn short, where the exact figure would only be noise: "812", "12.3K", "1.9M". */
export function formatCompact(value: number): string {
  return COMPACT.format(value);
}

/** A size in bytes as a line says it: "300 B", "4.2 kB", "48 kB", "1.5 MB", counted in thousands. */
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

/**
 * A fraction of some whole as a percentage, to `places` decimal places
 * (none unless asked), or a dash where there was no whole to take a share of.
 */
export function formatPercent(fraction: number | null, places = 0): string {
  if (fraction === null) return NO_SHARE;
  return `${(fraction * 100).toFixed(places)}%`;
}

/**
 * Dollars as a maintainer reads a bill, e.g. "$38,210" or "$6.42". A figure
 * above nothing that rounds to no cent says it is under one, so a real
 * spend never reads as free.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) return "<$0.01";
  return Math.abs(value) >= WHOLE_DOLLARS_FROM ? DOLLARS.format(value) : CENTS.format(value);
}
