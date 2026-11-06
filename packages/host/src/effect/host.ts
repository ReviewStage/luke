import {
  type GatewayHost,
  type GatewayShutdownOptions,
  type GatewayShutdownReport,
  type GatewayShutdownSteps,
  type NodeRegistry,
  shutdownGatewayEffect,
} from "@repo/gateway";
import { Context, Data, Deferred, Effect, Layer, Ref, type Scope } from "effect";
import type { Composer } from "../composer.js";
import type { HostConcern } from "../host-concerns.js";
import { layersInOrder } from "./composer.js";

export class HostDrainError extends Data.TaggedError("HostDrainError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return `the drain did not finish: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export type HostDrain = (
  options?: GatewayShutdownOptions,
) => Effect.Effect<GatewayShutdownReport, HostDrainError>;

export const hostDrain = Effect.fn("host/hostDrain")(function* (
  steps: GatewayShutdownSteps,
  report: (message: string) => void,
): Effect.fn.Return<HostDrain> {
  const claimed = yield* Ref.make(false);
  const outcome = yield* Deferred.make<GatewayShutdownReport, HostDrainError>();
  const run = (options: GatewayShutdownOptions) =>
    shutdownGatewayEffect(steps, options).pipe(
      Effect.catchDefect((cause) => new HostDrainError({ cause })),
      Effect.tap((settled) =>
        Effect.sync(() => {
          report(
            `shutting down: ${settled.settled ? "settled" : "unsettled"}, ${settled.canceled.length} canceled, ${settled.unresolved} unresolved`,
          );
        }),
      ),
      Effect.tapError((failure) => Effect.sync(() => report(failure.message))),
    );
  return (options = {}) =>
    Effect.gen(function* () {
      const taken = yield* Ref.getAndSet(claimed, true);
      if (!taken) yield* Deferred.into(run(options), outcome);
      return yield* Deferred.await(outcome);
    });
});

export interface HostAssembly {
  readonly gateway: GatewayHost;
  readonly nodes: NodeRegistry;
  readonly concerns: ReadonlySet<HostConcern>;
  readonly startOrder: readonly Composer[];
  readonly armed: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: HostDrain;
}

export class HostAssemblyTag extends Context.Service<HostAssemblyTag, HostAssembly>()(
  "@repo/host/HostAssembly",
) {}

export interface StandingHost {
  readonly gateway: GatewayHost;
  readonly drain: HostDrain;
}

export class HostTag extends Context.Service<HostTag, StandingHost>()("@repo/host/Host") {}

export const hostStandingLayer: Layer.Layer<HostTag, never, HostAssemblyTag> = Layer.unwrap(
  Effect.map(HostAssemblyTag, (assembly) => {
    const composers = layersInOrder(
      assembly.startOrder.map((composer) => Layer.effectDiscard(composer.lifetime)),
    );
    const armed = Layer.effectDiscard(assembly.armed);
    const standing = Layer.effect(
      HostTag,
      Effect.as(
        Effect.addFinalizer(() => Effect.ignore(assembly.drain())),
        { gateway: assembly.gateway, drain: assembly.drain },
      ),
    );
    return standing.pipe(Layer.provideMerge(armed), Layer.provideMerge(composers));
  }),
);
