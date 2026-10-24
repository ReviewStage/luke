/**
 * admin-format.ts -- how the admin page draws its trends and charts' days; its counts, shares, and dollars are `number-format.ts`'s and its days `time-format.ts`'s.
 */

import { formatCount, formatPercent } from "@luke/features/number-format";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL } from "@luke/features/sign-in-provider";
import { formatDayTick } from "@luke/features/time-format";

/**
 * The two runs a trend compares. The service's `AdminTrend` carries them, and
 * is read here by shape, because this package sits below the service and
 * must not import it.
 */
interface Trend {
  recent: number;
  prior: number;
}

/** The places a failure rate or a share of a few is drawn to, "1.4%", where a whole percent would hide a small one. */
export const RATE_PLACES = 1;

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
  if (trend.prior === 0) return `${sign}${formatCount(Math.abs(delta))}`;
  return `${sign}${formatPercent(Math.abs(delta / trend.prior))}`;
}

/** A linked provider's row value drawn as its label where the page knows one. */
export function signInMethodLabel(providerId: string): string {
  if (providerId === SOCIAL_PROVIDER.GITHUB) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GITHUB];
  if (providerId === SOCIAL_PROVIDER.GOOGLE) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GOOGLE];
  return providerId;
}
