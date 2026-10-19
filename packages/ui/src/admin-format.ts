/**
 * admin-format.ts -- how the admin page draws its counts, days, and trends.
 */

import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL } from "@luke/features/sign-in-provider";

/**
 * The two runs a trend compares. The service's `AdminTrend` carries them, and
 * is read here by shape, because this package sits below the service and
 * must not import it.
 */
interface Trend {
  recent: number;
  prior: number;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/**
 * A share of some whole, drawn as a percentage to one place, e.g. "1.4%",
 * or a dash where there was no whole to take a share of.
 */
export function formatShare(share: number | null): string {
  if (share === null) return "—";
  return `${(share * 100).toFixed(1)}%`;
}

const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A large count drawn short, e.g. "1.9M", where the exact figure would only be noise. */
export function formatCompact(value: number): string {
  return compactFormat.format(value);
}

/** From here a dollar figure drops its cents: they are noise beside the thousands. */
const WHOLE_DOLLARS_FROM = 1_000;

const centsFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dollarsFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Dollars as a maintainer reads a bill, e.g. "$38,210" or "$6.42". A figure
 * above nothing that rounds to no cent says it is under one, so a real
 * spend never reads as free.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) return "<$0.01";
  return Math.abs(value) >= WHOLE_DOLLARS_FROM
    ? dollarsFormat.format(value)
    : centsFormat.format(value);
}

/** An instant drawn as its UTC date alone, e.g. "Aug 3, 2026". */
export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

/** A day key drawn as a short axis tick, e.g. "Aug 21". */
export function formatDayTick(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A day key drawn as the day page's own masthead, e.g. "August 21, 2026". */
export function formatDayHeading(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}

/**
 * How faded today's bar draws. The series' last day is still filling, so a
 * bar rendered like a complete day's always reads as a dip; the fade and the
 * tooltip's "(so far today)" say the day is partial instead.
 */
export const PARTIAL_DAY_OPACITY = 0.45;

/** A tooltip label for one bar's day, saying so when that day is still filling. */
export function formatTooltipDay(day: string, partialDay: string | undefined): string {
  return day === partialDay ? `${formatDayTick(day)} (so far today)` : formatDayTick(day);
}

/** Which way a run moved against the one before it; the page that draws it picks the ink. */
export const TREND_DIRECTION = {
  UP: "up",
  DOWN: "down",
  FLAT: "flat",
} as const;

export type TrendDirection = (typeof TREND_DIRECTION)[keyof typeof TREND_DIRECTION];

export function trendDirection(trend: Trend): TrendDirection {
  if (trend.recent > trend.prior) return TREND_DIRECTION.UP;
  if (trend.recent < trend.prior) return TREND_DIRECTION.DOWN;
  return TREND_DIRECTION.FLAT;
}

/**
 * How the run moved against the one before it, as a percentage where there is
 * one to state. A prior run of zero has none — every rise from nothing is
 * infinite — so the move stands as its own count rather than a figure that
 * reads as precision it does not have.
 */
export function formatTrendMove(trend: Trend): string {
  const delta = trend.recent - trend.prior;
  if (delta === 0) return "flat";
  const sign = delta > 0 ? "+" : "−";
  if (trend.prior === 0) return `${sign}${formatNumber(Math.abs(delta))}`;
  return `${sign}${Math.abs(Math.round((delta / trend.prior) * 100))}%`;
}

/** A linked provider's row value drawn as its label where the page knows one. */
export function signInMethodLabel(providerId: string): string {
  if (providerId === SOCIAL_PROVIDER.GITHUB) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GITHUB];
  if (providerId === SOCIAL_PROVIDER.GOOGLE) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GOOGLE];
  return providerId;
}
