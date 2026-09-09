/**
 * One word for the end of a thing's life. A listener's unsubscribe, a watcher's
 * teardown, a timer's cancellation, and a store of all three are the same
 * shape, so a composition can hold what it created without knowing what any of
 * it was.
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * Wraps a teardown callback, which runs at most once however many times
 * `dispose()` is called. A callback that ran again on the second call would
 * make every double-dispose a bug the caller has to prevent, and the whole
 * point of handing an unsubscribe to a `DisposableStore` is that the caller
 * stops tracking whether it already ran. The callback is dropped rather than
 * flagged spent, so whatever it captured is collectable once it has run even
 * where the disposable itself is held on.
 */
export function toDisposable(run: () => void): IDisposable {
  let pending: (() => void) | undefined = run;
  return {
    dispose: () => {
      const held = pending;
      pending = undefined;
      held?.();
    },
  };
}

/**
 * Disposes every entry in iteration order, and lets a thrower stop none of the
 * rest: one owner's failed teardown must not leave its siblings alive. The
 * failures are reported together once the round is complete, as a single
 * `AggregateError` whatever their number, so a caller catches one shape rather
 * than deciding at run time whether it holds the failure or a bag of them.
 */
export function disposeAll(disposables: Iterable<IDisposable>): void {
  const failures: unknown[] = [];
  let attempted = 0;
  for (const disposable of disposables) {
    attempted += 1;
    try {
      disposable.dispose();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} of ${attempted} disposals failed`);
  }
}

/**
 * Holds what a composition created so one `dispose()` ends all of it, in the
 * reverse of the order it was added: the later entry is the one that may still
 * be reading the earlier, so unwinding a construction backwards is what keeps
 * a teardown from reaching through something already gone.
 */
export class DisposableStore implements IDisposable {
  #held: IDisposable[] = [];
  #disposed = false;

  /**
   * Answers the entry itself so a composition can hold and use a thing in one
   * expression. An entry added after the store was disposed is disposed at
   * once rather than kept: a store whose life is over must never become the
   * only reference to something alive.
   */
  add<T extends IDisposable>(disposable: T): T {
    if (this.#disposed) {
      disposable.dispose();
      return disposable;
    }
    this.#held.push(disposable);
    return disposable;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const held = this.#held;
    this.#held = [];
    disposeAll(held.reverse());
  }
}
