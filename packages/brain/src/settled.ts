export type Settled<T> = { aborted: true } | { aborted: false; value: T };

/**
 * Waits on a promise only as long as the signal stands. Once it fires the
 * wait settles as aborted at once and the promise's eventual value is
 * dropped unread — a late model answer or transcript can then reach nothing.
 * The promise's own rejection still propagates.
 */
export async function settledUnlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<Settled<T>> {
  if (signal.aborted) return { aborted: true };
  // A rejection after the abort has already answered would otherwise be
  // nobody's to handle; this branch takes it and the race below still sees
  // the rejection first when the promise settles before the signal.
  promise.catch(() => undefined);
  const aborted = new Promise<Settled<T>>((resolve) => {
    signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
  });
  const settled = await Promise.race([
    promise.then((value): Settled<T> => ({ aborted: false, value })),
    aborted,
  ]);
  return signal.aborted ? { aborted: true } : settled;
}
