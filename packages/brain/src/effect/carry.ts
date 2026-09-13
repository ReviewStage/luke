/**
 * The brain's one door onto the host's `ExecutionRuntime`. A turn, the
 * maintenance behind it, the tool loop, and the housekeeping run are each a
 * fiber end to end, and since P12-16g so is everything `BrainAgent` answers:
 * an ask, a wait, a cancel, a mark, a child's task, a context snapshot, a
 * stop, and a run-event subscription are all effects a caller runs. What is
 * still carried here is what holds a promise on the other side of the agent
 * rather than inside it, so the carrying happens once, here, rather than in
 * each file that holds one:
 *
 * - the agent's own `#detach`, which is how every turn nobody waits for is
 *   begun — the ask queue's drain, the wake window's flush and its roster
 *   look, the housekeeping a settled turn leaves behind, and a hold's release
 *   — because the run starts the work on the calling stack, so the turn takes
 *   its place in the conversation's queue in the same step that asked for it;
 * - and the host's side, where the promises are the seams above the agent:
 *   `wireBrain`'s own promise face — `rebuild` and `closeConversation` — which
 *   runs `BrainHost`'s transition as a promise because what asks for one is
 *   above this wiring, not inside the brain. The child service's executor
 *   seams left this list in P12-16k: `wiring-children.ts` writes each of them
 *   as an effect and `childSeamsOnRuntime` carries them to the OpenClaw port
 *   that awaits them.
 *
 * `BrainHost`'s transition chain and the publication chain's marks left this
 * door in P12-16j: a transition is an effect its caller runs and a follower is
 * a queue one fiber marks from. What retirement still asks of this file is
 * `detachOn`, which begins a stop's drain on a fiber of its own before it
 * returns and answers that fiber for the next transition to await.
 *
 * The live brain adapter left this door in P12-16l: it is built as an effect
 * on the composition's own runtime, so following an agent and asking it are
 * `yield*`s inside one effect the adapter runs there itself. The wake face
 * left that surface in P12-16c: `wake`, `rosterLook`, and
 * `releaseHeld` are effects the host's composers run, and the capture behind
 * them reads its transcript delta on the caller's own fiber. The read
 * prefetch left it in P12-16h: a slot is a fiber from the words that open it,
 * forked inside `anticipateAsk`'s own effect since P12-16g, so its plan, its
 * reads, and its summary carry nothing. The generation's context open and
 * the host's reset left it in P12-16i: the open is the effect the generation
 * holds, begun on the first fiber that asks it for a context and joined by
 * every fiber after (`once.ts`), and `resetConversation` answers the effect
 * its capture already was.
 *
 * A defect is squashed back to the error that caused it, so a store, a
 * listener, or an engine that threw reaches the caller as the error it threw
 * rather than as the fiber failure that carried it.
 *
 * @deprecated The strangler shim on the `Effect.runPromise` allowlist in
 * `docs/adr/0001-effect.md`; P12-04 deletes it with the seams that keep it,
 * once the host holds the brain in effects of its own.
 */
import type { ExecutionRuntime } from "@sidecar/runtime/vocabulary";
import { Cause, type Effect, Exit, type Fiber, ManagedRuntime, Runtime } from "effect";

/** Carries an effect to the promise a caller of the brain still holds, on the runtime the host handed in. */
export type Carry = <Value>(effect: Effect.Effect<Value>) => Promise<Value>;

/**
 * Begins an effect on a fiber of its own, on the runtime the host handed in,
 * before it returns: the runtime starts the work on the calling stack, so the
 * effect's first step — a stop's revocation of every run — stands in the step
 * that asked for it rather than in a scheduler task later, which is all
 * `Effect.forkDaemon` would give. What it answers is the fiber, so a caller
 * that must know how the work ended awaits it as one.
 */
export type Detach = <Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
) => Fiber.RuntimeFiber<Value, Failure>;

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

export const detachOn = (execution: ExecutionRuntime): Detach =>
  ManagedRuntime.TypeId in execution
    ? (effect) => execution.runFork(effect)
    : Runtime.runFork(execution);

export const carryOn = (execution: ExecutionRuntime): Carry => {
  const exits = runtimeExit(execution);
  return (effect) =>
    exits(effect).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    });
};
