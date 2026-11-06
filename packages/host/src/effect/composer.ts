import type { GatewayMethodTable } from "@repo/gateway";
import { Effect, Layer, type Scope } from "effect";
import { type Composer, type DuplicateGatewayMethod, foldMethods } from "../composer.js";

export const startedAndStopped = (
  start: Effect.Effect<void>,
  stop: Effect.Effect<void>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.uninterruptible(
    Effect.andThen(
      Effect.addFinalizer(() => stop),
      start,
    ),
  );

export const layersInOrder = <E, R>(
  layers: ReadonlyArray<Layer.Layer<never, E, R>>,
): Layer.Layer<never, E, R> =>
  layers.reduce<Layer.Layer<never, E, R>>(
    (earlier, later) => Layer.provideMerge(later, earlier),
    Layer.empty,
  );

export const mergedMethods = (
  composers: readonly Composer[],
): Effect.Effect<GatewayMethodTable, DuplicateGatewayMethod> =>
  Effect.suspend(() => Effect.fromResult(foldMethods(composers)));
