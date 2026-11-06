import { formatCount, formatPercent } from "@repo/features/number-format";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL } from "@repo/features/sign-in-provider";
import { formatDayTick } from "@repo/features/time-format";

interface Trend {
  recent: number;
  prior: number;
}

export const RATE_PLACES = 1;

export const PARTIAL_DAY_OPACITY = 0.45;

export function formatTooltipDay(day: string, partialDay: string | undefined): string {
  return day === partialDay ? `${formatDayTick(day)} (so far today)` : formatDayTick(day);
}

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

export function formatTrendMove(trend: Trend): string {
  const delta = trend.recent - trend.prior;
  if (delta === 0) return "flat";
  const sign = delta > 0 ? "+" : "−";
  if (trend.prior === 0) return `${sign}${formatCount(Math.abs(delta))}`;
  return `${sign}${formatPercent(Math.abs(delta / trend.prior))}`;
}

export function signInMethodLabel(providerId: string): string {
  if (providerId === SOCIAL_PROVIDER.GITHUB) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GITHUB];
  if (providerId === SOCIAL_PROVIDER.GOOGLE) return SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GOOGLE];
  return providerId;
}
