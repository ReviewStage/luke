export type Settled<T> = { cancelled: true } | { cancelled: false; value: T };

/**
 * Waits on a promise only as long as the signal stands. Once it fires the
 * wait settles as cancelled at once and the promise's eventual value is
 * dropped unread — a late model answer or transcript can then reach nothing.
 * The promise's own rejection still propagates.
 */
export function settledUnlessCancelled<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<Settled<T>> {
  return claimedUnlessCancelled(promise, signal, () => undefined);
}

/**
 * Waits on a promise whose value is a thing that must be owned by exactly
 * one party: the caller, when the value arrives while the signal stands, or
 * `discard`, when the signal fired first and the value arrives afterwards.
 * The decision is made once, at whichever comes first, so a cancel and a
 * resolution in the same turn — or in either order across turns — leave the
 * value either claimed or discarded, never both and never neither. A
 * rejection is the caller's when nothing was decided yet, and dropped after
 * the cancel answered.
 */
export function claimedUnlessCancelled<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  discard: (value: T) => void,
): Promise<Settled<T>> {
  return new Promise<Settled<T>>((resolve, reject) => {
    let decided = false;
    const cancel = () => {
      if (decided) return;
      decided = true;
      resolve({ cancelled: true });
    };
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        if (decided) {
          discard(value);
          return;
        }
        decided = true;
        signal.removeEventListener("abort", cancel);
        resolve({ cancelled: false, value });
      },
      (error: Error) => {
        if (decided) return;
        decided = true;
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}
