/**
 * Honest readings of the admin page's zero-filled daily series. The server
 * fills every day of its window, so a deployment with no activity draws the
 * same bars a flat one would, and the series runs through today (UTC), a
 * partial day whose bar reads as a dip beside complete ones. Both readings
 * derive from the response alone — "today" is `generatedAt`'s UTC day, never
 * this browser's clock — so neither can disagree with the series it reads.
 */

export function seriesHasNoData(totals: readonly number[]): boolean {
  return totals.every((total) => total === 0);
}

export function partialDayKey(
  daily: readonly { day: string }[],
  generatedAt: number,
): string | undefined {
  const last = daily.at(-1);
  if (last === undefined) return undefined;
  return last.day === new Date(generatedAt).toISOString().slice(0, 10) ? last.day : undefined;
}
