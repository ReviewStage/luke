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
