/**
 * renderer-runtime.ts -- the renderer's Effect edge: the services the panel's
 * own fibers run on.
 *
 * There is one set per window: every window is its own document loading
 * the one renderer bundle, so each instantiates this module once and builds
 * its services here, once. No two windows share them. Nothing here
 * may reach a layer that reaches `node:` — the renderer is a sandboxed browser
 * context, and a runtime is exactly the place a Node-reaching service would
 * arrive unnoticed.
 */

import { Cause, Context, Duration, Effect, Exit } from "effect";

/**
 * No service stands yet: what the services are for is holding the fibers the
 * panel forks, and a service arrives here when a surface needs one. They are
 * made once, so every fiber stands on the one set of services this bundle has.
 */
const RENDERER_SERVICES: Context.Context<never> = Context.empty();

/** The services the renderer's fibers run on, for a reading outside a fiber, such as the clock's time. */
export const rendererServicesNow = (): Context.Context<never> => RENDERER_SERVICES;

/**
 * A pause of the milliseconds handed, as a fiber of its own on the
 * renderer's services, for a promise-shaped caller that waits between tries
 * (`settings/add-skill-dialog.tsx`): each pause stands alone, so one never cuts
 * another short.
 */
export const rendererPause = (ms: number): Promise<void> =>
  Effect.runPromiseWith(rendererServicesNow())(Effect.sleep(Duration.millis(ms)));

/**
 * An effect run as a fiber of its own on the renderer's services, for a
 * caller that holds it from a React effect (`act-stream.ts`'s followed
 * streams): the stop handed back interrupts it, and returns without waiting
 * on its finalizers, as a cleanup must.
 */
export const rendererFork = (effect: Effect.Effect<void>): (() => void) => {
  const fiber = Effect.runForkWith(rendererServicesNow())(effect);
  return () => fiber.interruptUnsafe();
};

/**
 * An effect run to a promise on the renderer's services, for a caller that
 * awaits one: a TanStack Query `queryFn` (`use-app-state.ts`'s
 * `appStateQuery`, `live-reads.ts`'s reads), interrupted as `signal`
 * aborts where it is handed one. Note that a failure rejects with `Cause.squash` of its
 * cause, so the caller holds the failure the effect raised rather than a
 * fiber's own wrapping of it.
 */
export const rendererPromise = <A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> =>
  Effect.runPromiseExitWith(rendererServicesNow())(effect, { signal }).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
  );
