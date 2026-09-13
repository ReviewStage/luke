/**
 * The brain's door onto the host's `ExecutionRuntime`. A turn, the
 * maintenance behind it, the tool loop, and the housekeeping run are each a
 * fiber end to end, and since P12-16g so is everything `BrainAgent` answers:
 * an ask, a wait, a cancel, a mark, a child's task, a context snapshot, a
 * stop, and a run-event subscription are all effects a caller runs. What is
 * left here is the one shape no effect of the brain's can state for itself:
 *
 * - `detachOn`, the detach door, which is permanent. Every turn nobody waits
 *   for is begun through it — `AgentSeam#detach` for the ask queue's drain,
 *   the wake window's flush and its roster look, the housekeeping a settled
 *   turn leaves behind, and a hold's release; `BrainHost`'s retirement drain,
 *   whose fiber the next transition awaits; and, since P12-16n, the brain
 *   wiring's close and open of a conversation, each shared under its key as
 *   the settling of the fiber it was begun on. What only a run gives is
 *   the start: `Runtime.runFork` evaluates the effect on the calling stack up
 *   to its first suspension, so `BrainAgent#enqueue`'s own acquisition — the
 *   step that puts the turn in the conversation's queue and counts it busy —
 *   and a retirement's revocation of every standing run each stand in the
 *   step that asked for them. P12-20f put the conversation's own armed waits
 *   — the wake window and the ask ledger's wait — through the same door, for
 *   the opposite half of the same reason: a wait's first step is a sleep on
 *   the agent's `Clock`, so nothing of it has to stand in the step that armed
 *   it, and what a run gives there is a fiber a synchronous collaborator can
 *   arm and disarm at all. `Effect.fork`, `Effect.forkIn`, and
 *   `Effect.forkDaemon` all only tell the child fiber to resume, which the
 *   scheduler runs as a task later, so a stop arriving between the fork and
 *   that task would drain a queue the turn had not yet joined. P12-16m
 *   weighed the alternative — splitting a registration step out of the turn
 *   so a `forkIn` could run it uninterruptibly first — and kept the door
 *   instead: the registration is the queue's own `acquireUseRelease`, and
 *   prising it apart would give the conversation two places that count a turn
 *   rather than one.
 *
 * Nothing asks the brain for a promise. The host's own face over it —
 * `wireBrain`'s `rebuild`, `retire`, `openConversation`, and
 * `closeConversation` — is effects its composers run too, each conversation's
 * close and open begun through the door above.
 *
 * The child service's executor seams went in
 * P12-16k: `wiring-children.ts` writes each of them as an effect and
 * `childSeamsOnRuntime` carries them to the OpenClaw port that awaits them.
 * `BrainHost`'s transition chain and the publication chain's marks went in
 * P12-16j: a transition is an effect its caller runs and a follower is a
 * queue one fiber marks from. The live brain adapter went in P12-16l: it is
 * built as an effect on the composition's own runtime, so following an agent
 * and asking it are `yield*`s inside one effect the adapter runs there
 * itself. The wake face went in P12-16c: `wake`, `rosterLook`, and
 * `releaseHeld` are effects the host's composers run, and the capture behind
 * them reads its transcript delta on the caller's own fiber. The read
 * prefetch went in P12-16h: a slot is a fiber from the words that open it,
 * forked inside `anticipateAsk`'s own effect since P12-16g, so its plan, its
 * reads, and its summary carry nothing. The generation's context open and
 * the host's reset went in P12-16i: the open is the effect the generation
 * holds, begun on the first fiber that asks it for a context and joined by
 * every fiber after (`once.ts`), and `resetConversation` answers the effect
 * its capture already was. `AgentSeam#detach` went in P12-16m, onto the
 * detach door above.
 *
 * What keeps this file on the run allowlist, permanent in root AGENTS.md's
 * "Effect idioms" section, is `runtimeExit`, whose two callers are permanent
 * rows there because the `ModelAdapter` each answers is a promise, not a
 * fiber; the detach door is named permanent on the same list.
 */
import type { ExecutionRuntime } from "@sidecar/runtime/vocabulary";
import { type Effect, type Exit, type Fiber, ManagedRuntime, Runtime } from "effect";

/**
 * Begins an effect on a fiber of its own, on the runtime the host handed in,
 * before it returns: the runtime starts the work on the calling stack, so the
 * effect's first step — a stop's revocation of every run — stands in the step
 * that asked for it rather than in a scheduler task later, which is all
 * `Effect.forkDaemon` would give. What it answers is the fiber, so a caller
 * that must know how the work ended awaits it as one.
 *
 * The one option a caller passes is the scope the fiber belongs to, which is
 * what `BrainAgent#arm` hands its armed waits: a wait sleeping on the
 * conversation's clock is ended by the stop that closes the agent's scope,
 * whether or not the collaborator that armed it disarmed it first.
 */
export type Detach = <Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
  options?: Runtime.RunForkOptions,
) => Fiber.RuntimeFiber<Value, Failure>;

/**
 * Runs an effect to its `Exit` on the given runtime, dispatching between a
 * `ManagedRuntime` and a plain `Runtime` once rather than at each caller. The
 * one thing an effect itself cannot state — a caller's own `AbortSignal`,
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

export const detachOn = (execution: ExecutionRuntime): Detach => {
  if (ManagedRuntime.TypeId in execution) {
    return (effect, options) => execution.runFork(effect, options);
  }
  const fork = Runtime.runFork(execution);
  return (effect, options) => fork(effect, options);
};
