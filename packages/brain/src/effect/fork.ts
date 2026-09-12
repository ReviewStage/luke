/**
 * The brain's one fork onto the host's `ExecutionRuntime`, beside `carryOn`'s
 * one promise door. What needs it is work the brain begins where no fiber of
 * the caller's stands: the read prefetch's slot, opened by a live session
 * saying `anticipateAsk` while the developer is still speaking. The slot is a
 * fiber of its own from that call on — its policy, its planner, its reads,
 * and its summary all run in it, and the words that supersede it, the take
 * that outlasts its wait, and the drop that abandons it each end it as that
 * fiber's interruption.
 *
 * It is not a promise door: nothing here is awaited and nothing is carried
 * back. The fiber is handed to the slot that owns it, and the value the turn
 * later takes travels through that slot's own `Deferred`.
 *
 * @deprecated A strangler shim on the run allowlist in
 * `docs/adr/0001-effect.md`; it goes once `anticipateAsk` answers an effect
 * the host forks itself, which is the same move that takes `carryOn` with it.
 */
import type { ExecutionRuntime } from "@sidecar/runtime/vocabulary";
import type { Effect, Fiber } from "effect";
import { ManagedRuntime, Runtime } from "effect";

/** Starts an effect on the runtime the host handed in, answering the fiber it runs as. */
export type ForkOn = <Value>(effect: Effect.Effect<Value>) => Fiber.RuntimeFiber<Value>;

export const forkOn = (execution: ExecutionRuntime): ForkOn =>
  ManagedRuntime.TypeId in execution
    ? (effect) => execution.runFork(effect)
    : Runtime.runFork(execution);
