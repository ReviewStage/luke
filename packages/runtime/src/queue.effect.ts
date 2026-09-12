/**
 * The reply queue in Effect's own terms. `queue.ts` is a port of OpenClaw
 * `b7528507` and stays faithful to it — it imports nothing from `effect` — so
 * everything Effect needs of the queue lives here beside it: the refusals as
 * typed errors carrying the codes the port already decides, the debounce as a
 * `Schedule` a caller can compose, and the live queue as a scoped resource
 * whose timer the scope disarms.
 *
 * This is the shape every OpenClaw wrap in this repository copies: a sibling
 * named for the ported file, wrapping its exported API and reaching inside
 * none of it.
 */
import type { Fiber } from "effect";
import { Data, Duration, Effect, FiberId, Runtime, Schedule, type Scope } from "effect";
import {
  admitToQueue,
  DEFAULT_QUEUE_SETTINGS,
  PendingInputQueue,
  type PendingInputQueueOptions,
  type PendingQueueState,
  type QueueAdmission,
  type QueuedInput,
  type QueueMode,
  type QueueSettings,
  type ScheduledTimer,
} from "./queue.js";

/** Why an input the queue was offered did not enter it. */
export const QUEUE_REFUSAL = {
  /** An input with that id was already waiting, so a duplicate opens no second turn. */
  DUPLICATE: "duplicate",
  /** The queue was full and the overflow policy let this input go rather than an older one. */
  OVERFLOW: "overflow",
} as const;

export type QueueRefusal = (typeof QUEUE_REFUSAL)[keyof typeof QUEUE_REFUSAL];

/** Why a withdrawal named nothing the queue could take back. */
export const QUEUE_WITHDRAWAL_REFUSAL = {
  /** No entry carries that id: it was steered, drained, or never queued. */
  NOT_QUEUED: "not-queued",
  /** No summarized input stands at that place in the fold order. */
  NOT_SUMMARIZED: "not-summarized",
} as const;

export type QueueWithdrawalRefusal =
  (typeof QUEUE_WITHDRAWAL_REFUSAL)[keyof typeof QUEUE_WITHDRAWAL_REFUSAL];

export class QueueAdmissionRefused extends Data.TaggedError("QueueAdmissionRefused")<{
  readonly code: QueueRefusal;
  readonly input: QueuedInput;
}> {}

export class QueueWithdrawalRefused extends Data.TaggedError("QueueWithdrawalRefused")<{
  readonly code: QueueWithdrawalRefusal;
}> {}

/**
 * Admits one input into a state the caller holds, as the port does, and fails
 * with the refusal's own code where the port answers `admitted: false`. The
 * evictions the overflow made ride on the success, since a fold that admitted
 * the input still let an older one go.
 */
export const admitInput = (
  state: PendingQueueState,
  input: QueuedInput,
  settings: Pick<QueueSettings, "capacity" | "overflow"> = DEFAULT_QUEUE_SETTINGS,
): Effect.Effect<QueueAdmission, QueueAdmissionRefused> =>
  Effect.suspend(() => {
    const admission = admitToQueue(state, input, settings);
    if (admission.admitted) return Effect.succeed(admission);
    return Effect.fail(
      new QueueAdmissionRefused({
        code: admission.evicted.length === 0 ? QUEUE_REFUSAL.DUPLICATE : QUEUE_REFUSAL.OVERFLOW,
        input,
      }),
    );
  });

/**
 * The debounce as a cadence rather than a number: the window the collect mode
 * gathers within, stated once so a caller composing its own repeat reads the
 * same delay the live queue arms.
 */
export const queueDebounceSchedule = (
  settings: Pick<QueueSettings, "debounceMs"> = DEFAULT_QUEUE_SETTINGS,
): Schedule.Schedule<Duration.Duration> =>
  Schedule.fromDelays(Duration.millis(settings.debounceMs));

/** The live queue's operations, each as an effect, with the refusals typed. */
export interface EffectPendingInputQueue {
  readonly settings: QueueSettings;
  readonly state: Effect.Effect<PendingQueueState>;
  readonly size: Effect.Effect<number>;
  readonly push: (
    input: QueuedInput,
    mode?: QueueMode,
  ) => Effect.Effect<void, QueueAdmissionRefused>;
  readonly flush: (mode?: QueueMode) => Effect.Effect<void>;
  readonly withdraw: (id: string) => Effect.Effect<void, QueueWithdrawalRefused>;
  readonly withdrawSummarized: (index: number) => Effect.Effect<void, QueueWithdrawalRefused>;
  readonly clear: Effect.Effect<void>;
}

export type EffectPendingInputQueueOptions = Omit<PendingInputQueueOptions, "schedule" | "cancel">;

/**
 * The `schedule`/`cancel` pair the port's constructor still takes, answered
 * from this runtime's own `Clock` so the debounce it arms reads whichever
 * clock the runtime carries — the real one in production, a `TestClock` in a
 * test — without the port itself importing `effect`. Starting the fiber here
 * is a run outside an Effect, which the "runtime only at an edge" rule allows
 * precisely because this is that edge: it starts the work on the runtime it
 * was handed rather than building a second one. `cancel` has no way to be
 * awaited, so it interrupts the fiber without waiting for the interruption to
 * finish: what it must guarantee is that the callback does not run
 * afterwards, never that the fiber has already ended.
 */
const scheduleOnRuntime = (
  runtime: Runtime.Runtime<never>,
): Pick<PendingInputQueueOptions, "schedule" | "cancel"> => {
  const fork = Runtime.runFork(runtime);
  const armed = new Map<ScheduledTimer, Fiber.RuntimeFiber<void>>();
  return {
    schedule: (callback, delayMs) => {
      const handle: ScheduledTimer = {};
      const fiber = fork(
        Effect.delay(Effect.sync(callback), Duration.millis(delayMs)).pipe(
          Effect.ensuring(Effect.sync(() => armed.delete(handle))),
        ),
      );
      armed.set(handle, fiber);
      return handle;
    },
    cancel: (timer) => {
      const fiber = armed.get(timer);
      if (fiber === undefined) return;
      armed.delete(timer);
      fiber.unsafeInterruptAsFork(FiberId.none);
    },
  };
};

/**
 * The live queue of one conversation, armed on the runtime's own `Clock` and
 * owned by a `Scope`: closing the scope forgets what waits and disarms the
 * debounce, so no drained turn opens after the conversation that held it is
 * gone.
 */
export const makePendingInputQueue = (
  options: EffectPendingInputQueueOptions,
): Effect.Effect<EffectPendingInputQueue, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.map(Effect.runtime<never>(), (runtime) => {
      const queue = new PendingInputQueue({ ...options, ...scheduleOnRuntime(runtime) });
      return { queue, wrapped: wrap(queue) };
    }),
    ({ queue }) => Effect.sync(() => queue.clear()),
  ).pipe(Effect.map(({ wrapped }) => wrapped));

const wrap = (queue: PendingInputQueue): EffectPendingInputQueue => ({
  settings: queue.settings,
  state: Effect.sync(() => queue.state),
  size: Effect.sync(() => queue.size),
  push: (input, mode) =>
    Effect.suspend(() => {
      const duplicate = queue.state.entries.some((entry) => entry.id === input.id);
      if (queue.push(input, mode)) return Effect.void;
      return Effect.fail(
        new QueueAdmissionRefused({
          code: duplicate ? QUEUE_REFUSAL.DUPLICATE : QUEUE_REFUSAL.OVERFLOW,
          input,
        }),
      );
    }),
  flush: (mode) => Effect.sync(() => queue.flush(mode)),
  withdraw: (id) =>
    Effect.suspend(() =>
      queue.withdraw(id)
        ? Effect.void
        : Effect.fail(new QueueWithdrawalRefused({ code: QUEUE_WITHDRAWAL_REFUSAL.NOT_QUEUED })),
    ),
  withdrawSummarized: (index) =>
    Effect.suspend(() =>
      queue.withdrawSummarized(index)
        ? Effect.void
        : Effect.fail(
            new QueueWithdrawalRefused({ code: QUEUE_WITHDRAWAL_REFUSAL.NOT_SUMMARIZED }),
          ),
    ),
  clear: Effect.sync(() => queue.clear()),
});
