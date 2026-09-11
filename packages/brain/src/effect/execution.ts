/**
 * The one runtime a conversation's work runs on, and the door back to the
 * `Promise` the vocabulary still hands its callers.
 *
 * A run is a fiber: the tool loop between a model and its tools is started
 * once, on a runtime the host built and handed in rather than one built here,
 * and a cancel is that fiber's interruption. Nothing in this module builds a
 * runtime of its own — a second runtime is a second copy of every service a
 * `Context.Tag` was supposed to identify — so a caller with none is answered
 * by Effect's own default, which is the runtime this process already stands
 * on rather than one more.
 */
import { Cause, type Effect, Exit, ManagedRuntime, Runtime } from "effect";

/** A runtime a run can be started on: the managed one an edge holds, or a plain one. */
export type BrainExecutionRuntime =
  | ManagedRuntime.ManagedRuntime<never, never>
  | Runtime.Runtime<never>;

/** The runtime a caller that was handed none runs on: the process's own, never a second one built here. */
export const defaultBrainExecutionRuntime = (): BrainExecutionRuntime => Runtime.defaultRuntime;

const exitOf = (
  runtime: BrainExecutionRuntime,
): (<A>(effect: Effect.Effect<A>) => Promise<Exit.Exit<A>>) =>
  ManagedRuntime.TypeId in runtime
    ? (effect) => runtime.runPromiseExit(effect)
    : Runtime.runPromiseExit(runtime);

/**
 * Starts a run on the runtime it was handed and answers the `Promise` the
 * `AgentRuntime` vocabulary declares. A defect is squashed back to the error
 * that caused it, so a listener or an engine that threw reaches the caller as
 * the error it threw rather than as the fiber failure that carried it.
 *
 * Running here is a run outside a runtime edge, which the rule allows
 * precisely because this door is that edge for as long as it exists: the
 * `AgentRuntime` contract answers a run with `done: Promise<RuntimeRunEnd>`,
 * and the door goes with that `Promise` when the contract itself moves.
 *
 * @deprecated The strangler shim on the `Effect.runPromise` allowlist in
 * `docs/adr/0001-effect.md`; P5-14b deletes it once `AgentRuntime` answers a
 * run with an `Effect`.
 */
export const runOnBrainRuntime = <A>(
  runtime: BrainExecutionRuntime,
  effect: Effect.Effect<A>,
): Promise<A> =>
  exitOf(runtime)(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  });
