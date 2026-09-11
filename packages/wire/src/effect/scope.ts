/**
 * The bridge between `IDisposable` and Effect's `Scope`, while both stand.
 * A `Scope` already guarantees what `DisposableStore` was written for — the
 * finalizers run in the reverse of the order they were added, and a thrower
 * stops none of the rest — so what is left is carrying a disposable into a
 * scope and a scope back out to a caller that only knows `dispose()`.
 *
 * This module is a strangler shim: P12-06 deletes it together with
 * `DisposableStore`, `toDisposable`, and `disposeAll`.
 */
import { Cause, Chunk, type Context, Effect, Exit, Layer, Scope } from "effect";
import type { IDisposable } from "../lifecycle.js";

const disposeEffect = (disposable: IDisposable): Effect.Effect<void> =>
  Effect.sync(() => disposable.dispose());

/**
 * Ends the disposable when the scope closes, and answers the disposable itself
 * so a composition can hold and use a thing in one expression, the way
 * `DisposableStore.add` does. A scope already closed runs the finalizer at
 * once, which is the same rule: a lifetime that is over must never become the
 * only reference to something alive.
 */
export const addDisposable = <T extends IDisposable>(
  scope: Scope.Scope,
  disposable: T,
): Effect.Effect<T> => Effect.as(Scope.addFinalizer(scope, disposeEffect(disposable)), disposable);

/**
 * A closed scope's finalizers may each have failed, and a caller in the Promise
 * world catches one shape rather than deciding at run time whether it holds a
 * failure or a bag of them. This is `disposeAll`'s `AggregateError` written
 * from a `Cause`, so a caller unaware that the store became a scope sees no
 * difference.
 */
const disposalFailure = (cause: Cause.Cause<never>): AggregateError => {
  const failures = Chunk.toReadonlyArray(Cause.defects(cause));
  return new AggregateError(failures, `${failures.length} disposals failed`);
};

/**
 * Hands a scope to a caller that speaks only `dispose()`. Closing a scope is an
 * Effect and this returns to the Promise world, so the run happens here, which
 * the "runtime only at an edge" rule allows precisely because the bridge is
 * that edge for as long as it exists: every caller of this function is code
 * that has not migrated yet, and P12-06 deletes the function with the last of
 * them. The close is synchronous, so a scope holding an asynchronous finalizer
 * throws rather than closing in the background — `dispose()` has no way to be
 * awaited, and a teardown nobody can wait for is worse than a loud one.
 */
export const disposableFromScope = (scope: Scope.CloseableScope): IDisposable => ({
  dispose: () => {
    const closed = Effect.runSyncExit(Scope.close(scope, Exit.void));
    if (Exit.isFailure(closed)) throw disposalFailure(closed.cause);
  },
});

/**
 * The service a tag names is built and disposed with the scope the layer is
 * built in, which is what a composition holding an `IDisposable` in a
 * `DisposableStore` was saying.
 */
export const layerFromDisposable = <Identifier, Service extends IDisposable, E, R>(
  tag: Context.Tag<Identifier, Service>,
  make: Effect.Effect<Service, E, R>,
): Layer.Layer<Identifier, E, Exclude<R, Scope.Scope>> =>
  Layer.scoped(tag, Effect.acquireRelease(make, disposeEffect));
