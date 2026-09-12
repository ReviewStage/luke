/**
 * The host as it stands once every composer has started, as a `Layer` over
 * its assembly.
 *
 * The assembly is the construction the merge already performs — every
 * composer built and linked, the method tables folded, the service composed —
 * and holds nothing that has begun. The standing layer is what begins it: the
 * composers' layers in the launch's order, the arming of the loops after the
 * last of them, and the drain registered last of all, so that closing the one
 * scope the layer was built in runs the drain first, disarms the loops, and
 * stops every composer in the reverse of the order it started. That close is
 * the whole quit, and there is no other order to run it in.
 */
import {
  type GatewayShutdownOptions,
  type GatewayShutdownReport,
  type GatewayShutdownSteps,
  shutdownGatewayEffect,
} from "@sidecar/gateway";
import type { GatewayInProcessHost } from "@sidecar/gateway/server";
import { Context, Data, Deferred, Effect, Layer, Ref, type Scope } from "effect";
import type { Composer } from "../composer.js";
import { composerLayer, layersInOrder } from "./composer.js";

/** The drain's steps did not run to their end; what they could not settle is what the next launch marks interrupted. */
export class HostDrainError extends Data.TaggedError("HostDrainError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return `the drain did not finish: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

/**
 * The explicit quit's steps, run once whichever door asks for them: the
 * adaptor's `stop` with the caller's own deadline, or the scope's own close
 * with the defaults. A second ask joins the first rather than closing the
 * admissions and cancelling the runs again.
 */
export type HostDrain = (
  options?: GatewayShutdownOptions,
) => Effect.Effect<GatewayShutdownReport, HostDrainError>;

/**
 * The explicit quit's steps as the one drain both doors run: the first ask
 * runs them under its own options and reports what became of them, and every
 * later ask, whatever its options, is answered with that outcome, so the
 * admissions close and the runs are cancelled once however many times the
 * quit arrives.
 */
export const hostDrain = (
  steps: GatewayShutdownSteps,
  report: (message: string) => void,
): Effect.Effect<HostDrain> =>
  Effect.gen(function* () {
    const claimed = yield* Ref.make(false);
    const outcome = yield* Deferred.make<GatewayShutdownReport, HostDrainError>();
    const run = (options: GatewayShutdownOptions) =>
      shutdownGatewayEffect(steps, options).pipe(
        // A step that threw is a defect of the coordinator's own effect, since
        // the steps it runs are promises it did not write; it is the drain's
        // named refusal here rather than a defect that would take the close
        // down with it.
        Effect.catchAllDefect((cause) => new HostDrainError({ cause })),
        Effect.tap((settled) =>
          Effect.sync(() => {
            report(
              `shutting down: ${settled.settled ? "settled" : "unsettled"}, ${settled.cancelled.length} cancelled, ${settled.unresolved} unresolved`,
            );
          }),
        ),
        Effect.tapError((failure) => Effect.sync(() => report(failure.message))),
      );
    return (options = {}) =>
      Effect.gen(function* () {
        const taken = yield* Ref.getAndSet(claimed, true);
        if (!taken) yield* Effect.intoDeferred(run(options), outcome);
        return yield* Deferred.await(outcome);
      });
  });

/** Everything constructed and linked, and nothing yet begun. */
export interface HostAssembly {
  /** The one boundary a client reaches this host through: the in-process host every transport here is bound to. */
  readonly gateway: GatewayInProcessHost;
  /** The composers in the order the launch has to keep; the quit is this order reversed. */
  readonly startOrder: readonly Composer[];
  /**
   * What the launch arms once every owner of a cadence has started, in the
   * scope the host stands in: the account gate opened where it already stands
   * open, and the scope's own close is what disarms it, before any composer
   * stops.
   */
  readonly armed: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: HostDrain;
}

export class HostAssemblyTag extends Context.Tag("@sidecar/host/HostAssembly")<
  HostAssemblyTag,
  HostAssembly
>() {}

/** The host with every composer started: what a client operates and what the quit drains. */
export interface StandingHost {
  readonly gateway: GatewayInProcessHost;
  readonly drain: HostDrain;
}

export class HostTag extends Context.Tag("@sidecar/host/Host")<HostTag, StandingHost>() {}

/**
 * The composers started in the assembly's order, the loops armed after the
 * last of them, and the drain registered as the last finalizer, so the scope
 * this layer is built in closes as the quit: drain, disarm, then every
 * composer's stop in the reverse of its start.
 */
export const hostStandingLayer: Layer.Layer<HostTag, never, HostAssemblyTag> = Layer.unwrapEffect(
  Effect.map(HostAssemblyTag, (assembly) => {
    const composers = layersInOrder(assembly.startOrder.map(composerLayer));
    const armed = Layer.scopedDiscard(assembly.armed);
    const standing = Layer.scoped(
      HostTag,
      Effect.as(
        Effect.addFinalizer(() => Effect.ignore(assembly.drain())),
        { gateway: assembly.gateway, drain: assembly.drain },
      ),
    );
    return standing.pipe(Layer.provideMerge(armed), Layer.provideMerge(composers));
  }),
);
