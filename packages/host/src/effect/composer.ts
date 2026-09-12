/**
 * A composer as a `Layer`: the lifetime it answers runs when the layer is
 * built and the finalizers that lifetime registered run when the scope the
 * layer was built in closes, so that scope is the composer's lifetime and
 * closing it is its stop.
 */
import type { GatewayMethodTable } from "@sidecar/gateway";
import { Effect, Layer, type Scope } from "effect";
import { type Composer, type DuplicateGatewayMethod, foldMethods } from "../composer.js";

/**
 * A lifetime written as the two halves a concern that holds something has:
 * what it begins, and what gives that back. The stop is registered before the
 * start runs, not as the release of a successful acquire, because a
 * composer's stop is written to give back what a partial or failed start
 * allocated, so a start that throws after opening its store is still stopped
 * when the failed build releases what began. The start itself runs to its end
 * like an acquire, so an interruption never leaves a stop standing over a
 * start still under way; whatever the lifetime arms after this runs
 * interruptibly, in the same scope, so its own finalizers run before the stop.
 */
export const startedAndStopped = (
  start: Effect.Effect<void>,
  stop: Effect.Effect<void>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.uninterruptible(
    Effect.zipRight(
      Effect.addFinalizer(() => stop),
      start,
    ),
  );

/**
 * The layers built one after another in the order given, each in the same
 * sequential scope, so their releases run in the reverse of it. `Layer.merge`
 * is not this: it builds its two sides concurrently and closes them in
 * parallel, which is exactly the order a host's start and stop must not have.
 */
export const layersInOrder = <E, R>(
  layers: ReadonlyArray<Layer.Layer<never, E, R>>,
): Layer.Layer<never, E, R> =>
  layers.reduce<Layer.Layer<never, E, R>>(
    (earlier, later) => Layer.provideMerge(later, earlier),
    Layer.empty,
  );

/** The composers' method tables folded into one, or the collision that fails the build holding it. */
export const mergedMethods = (
  composers: readonly Composer[],
): Effect.Effect<GatewayMethodTable, DuplicateGatewayMethod> =>
  Effect.suspend(() => foldMethods(composers));
