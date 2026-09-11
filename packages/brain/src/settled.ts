/**
 * The Promise door over the interruption bridge in `./effect/settled.ts`.
 *
 * Running the effect here is a run outside a runtime edge, which the rule
 * allows precisely because this door is that edge for as long as it exists:
 * every caller of these two functions holds a promise rather than a fiber, and
 * P12-02 deletes the door with the last of them.
 */
import { Cause, Effect, Exit } from "effect";
import {
  claimedUnlessAborted as claimedEffect,
  type Settled,
  settledUnlessAborted as settledEffect,
} from "./effect/settled.js";

export type { Settled };

/**
 * The promise a caller hands in is already running, and the bridge may answer
 * without ever starting the work it was wrapped in — a signal that had already
 * fired settles the wait on its own. So the outcome is observed here, at the
 * door, rather than when the effect runs: a rejection has its handler from the
 * moment the door is called, and can never surface as an unhandled one.
 */
const observed = <T>(promise: Promise<T>): Effect.Effect<T> => {
  const outcome = promise.then(Exit.succeed, Exit.die);
  return Effect.flatten(Effect.promise(() => outcome));
};

/**
 * A rejection is the caller's own error rather than the fiber failure that
 * carried it, so a caller that has not migrated catches what it always caught.
 */
const runSettled = <T>(work: Effect.Effect<Settled<T>>): Promise<Settled<T>> =>
  Effect.runPromiseExit(work).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  });

/**
 * Waits on a promise only as long as the signal stands. Once it fires the
 * wait settles as aborted at once and the promise's eventual value is
 * dropped unread — a late model answer or transcript can then reach nothing.
 * The promise's own rejection still propagates.
 *
 * @deprecated The bridge is `settledUnlessAborted` in `./effect/settled.ts`;
 * P12-02 deletes this Promise signature once every caller runs its own fiber.
 */
export function settledUnlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<Settled<T>> {
  return runSettled(settledEffect(observed(promise), signal));
}

/**
 * Waits on a promise whose value is a thing that must be owned by exactly
 * one party: the caller, when the value arrives while the signal stands, or
 * `discard`, when the signal fired first and the value arrives afterwards.
 * The decision is made once, at whichever comes first, so an abort and a
 * resolution in the same turn — or in either order across turns — leave the
 * value either claimed or discarded, never both and never neither. A
 * rejection is the caller's when nothing was decided yet, and dropped after
 * the abort answered.
 *
 * @deprecated The bridge is `claimedUnlessAborted` in `./effect/settled.ts`;
 * P12-02 deletes this Promise signature once every caller runs its own fiber.
 */
export function claimedUnlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  discard: (value: T) => void,
): Promise<Settled<T>> {
  return runSettled(claimedEffect(observed(promise), signal, discard));
}
