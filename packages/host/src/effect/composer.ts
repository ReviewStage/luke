/**
 * A composer as a `Layer`: its `start` runs when the layer is built and its
 * `stop` when the scope the layer was built in closes, so that scope is the
 * composer's lifetime and closing it is its stop. Nothing of a composer's own
 * body is converted here — each start and stop is the promise the composer
 * already answers, wrapped — so a rejection of either is a defect until the
 * composer's own PR types its failures.
 */
import type { GatewayMethodTable } from "@sidecar/gateway";
import { Effect, Layer } from "effect";
import { type Composer, type DuplicateGatewayMethod, foldMethods } from "../composer.js";

/**
 * The stop is registered before the start runs, not as the release of a
 * successful acquire: a composer's `stop` is written to give back what a
 * partial or failed `start` allocated, so a start that throws after opening
 * its store is still stopped when the failed build releases what began.
 * The start itself runs to its end like an acquire, so an interruption never
 * leaves a stop standing over a start still under way.
 */
export const composerLayer = (composer: Composer): Layer.Layer<never> =>
  Layer.scopedDiscard(
    Effect.uninterruptible(
      Effect.zipRight(
        Effect.addFinalizer(() => Effect.promise(() => composer.stop())),
        Effect.promise(() => composer.start()),
      ),
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
