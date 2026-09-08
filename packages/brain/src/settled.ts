export type Settled<T> = { aborted: true } | { aborted: false; value: T };

/**
 * Waits on a promise only as long as the signal stands. Once it fires the
 * wait settles as aborted at once and the promise's eventual value is
 * dropped unread — a late model answer or transcript can then reach nothing.
 * The promise's own rejection still propagates.
 */
export function settledUnlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<Settled<T>> {
  return claimedUnlessAborted(promise, signal, () => undefined);
}

/**
 * Waits on a promise whose value is a thing that must be owned by exactly
 * one party: the caller, when the value arrives while the signal stands, or
 * `discard`, when the signal fired first and the value arrives afterwards.
 * The decision is made once, at whichever comes first, so an abort and a
 * resolution in the same turn — or in either order across turns — leave the
 * value either claimed or discarded, never both and never neither. A
 * rejection is the caller's when nothing was decided yet, and dropped after
 * the abort answered.
 */
export function claimedUnlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  discard: (value: T) => void,
): Promise<Settled<T>> {
  return new Promise<Settled<T>>((resolve, reject) => {
    let decided = false;
    const abort = () => {
      if (decided) return;
      decided = true;
      resolve({ aborted: true });
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        if (decided) {
          discard(value);
          return;
        }
        decided = true;
        signal.removeEventListener("abort", abort);
        resolve({ aborted: false, value });
      },
      (error: Error) => {
        if (decided) return;
        decided = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
