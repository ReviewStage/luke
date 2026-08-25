export interface DailyUsagePoint {
  day: string;
  voiceCalls: number;
  attentionReviews: number;
}

/** Days worth offering as drill-downs, oldest to newest like the chart. */
export function activeUsageDays<T extends DailyUsagePoint>(daily: readonly T[]): T[] {
  return daily.filter((point) => point.voiceCalls + point.attentionReviews > 0);
}

/** The freshest active day is the useful default, never a trailing zero-fill. */
export function defaultUsageDay(daily: readonly DailyUsagePoint[]): string {
  return activeUsageDays(daily).at(-1)?.day ?? "";
}
