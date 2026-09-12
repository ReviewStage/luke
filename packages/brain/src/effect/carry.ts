/**
 * The brain's one door onto the host's `ExecutionRuntime`. A turn, the
 * maintenance behind it, and the housekeeping run are each a fiber end to
 * end; what is still a promise is the surface `BrainAgent` answers a host on
 * — an ask, a wake, a child's task — and the `ToolExecutor` seam the tool
 * loop dispatches through. Both of those are promises because the seams
 * above and below them are, so the carrying happens once, here, rather than
 * in each file that holds one.
 *
 * A defect is squashed back to the error that caused it, so a store, a
 * listener, or an engine that threw reaches the caller as the error it threw
 * rather than as the fiber failure that carried it.
 *
 * @deprecated The strangler shim on the `Effect.runPromise` allowlist in
 * `docs/adr/0001-effect.md`; P12-04 deletes it with the seams that keep it,
 * once `BrainAgent`'s own surface and the `ToolExecutor` answer effects.
 */
import type { ExecutionRuntime } from "@sidecar/runtime/vocabulary";
import { Cause, type Effect, Exit, ManagedRuntime, Runtime } from "effect";

/** Carries an effect to the promise a caller of the brain still holds, on the runtime the host handed in. */
export type Carry = <Value>(effect: Effect.Effect<Value>) => Promise<Value>;

/**
 * Runs an effect to its `Exit` on the given runtime, dispatching between a
 * `ManagedRuntime` and a plain `Runtime` once rather than at each caller. The
 * one thing `Carry` itself cannot state — a caller's own `AbortSignal`,
 * joined to the run so an aborted call ends as this fiber's own interruption
 * — is this function's second, optional argument; `BrainTransport#send` and
 * `tracedModelAdapter` are the two callers that still read a signal this way,
 * because the `ModelAdapter` they answer is a promise, not a fiber.
 */
export const runtimeExit =
  (execution: ExecutionRuntime) =>
  <Value, Failure = never>(
    effect: Effect.Effect<Value, Failure>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Exit.Exit<Value, Failure>> =>
    ManagedRuntime.TypeId in execution
      ? execution.runPromiseExit(effect, options)
      : Runtime.runPromiseExit(execution)(effect, options);

export const carryOn = (execution: ExecutionRuntime): Carry => {
  const exits = runtimeExit(execution);
  return (effect) =>
    exits(effect).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    });
};
