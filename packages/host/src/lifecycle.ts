import type { GatewayShutdownSteps } from "@sidecar/gateway";
import { Effect, type Fiber, Ref } from "effect";

/**
 * Two moments of the runtime host's life where one concern must not decide
 * another's fate: the workspace seed and the memory index at start, and the
 * counted events and the run drain at the explicit quit.
 */

export interface StartupStoreOptions {
  /** Seeds the workspace's missing files; a failure is reported and stops nothing else. */
  seedWorkspace: () => Promise<void>;
  /** Starts the notebook index; its own settling is nobody's to wait on. */
  startMemory: () => Promise<void>;
  report: (message: string) => void;
}

/**
 * The workspace's missing files are seeded at every live launch and never
 * rewritten. A seed that failed leaves the files that already stand, which
 * are still worth indexing, so the index starts whatever became of the seed
 * and the start does not wait on the index.
 */
export async function seedWorkspaceThenStartMemory(options: StartupStoreOptions): Promise<void> {
  try {
    await options.seedWorkspace();
  } catch (error) {
    options.report(
      `Brain workspace could not be seeded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  void options.startMemory();
}

/**
 * A step that begins beside the drain rather than inside it: the first ask
 * forks it, every later ask finds the fiber already running, and what waits
 * on it joins that one fiber. A fork rather than a sequence, because both
 * wrappers below begin their work at one step of the quit and wait for it at
 * another; an outcome of either kind is swallowed, since a flush that failed
 * and a session that would not close are counts nobody has rather than quits
 * that failed.
 */
interface BegunOnce {
  readonly begin: Effect.Effect<void>;
  readonly settled: Effect.Effect<void>;
}

function begunOnce(work: Effect.Effect<void>): Effect.Effect<BegunOnce> {
  return Effect.map(Ref.make<Fiber.Fiber<void> | undefined>(undefined), (held) => ({
    begin: Effect.flatMap(Ref.get(held), (running) =>
      running === undefined
        ? Effect.flatMap(Effect.forkDaemon(Effect.asVoid(Effect.exit(work))), (forked) =>
            // A daemon rather than a child, because the step that begins the
            // work and the step that waits on it are not the same fiber: the
            // cancellations run inside the coordinator's deadline, and a
            // child forked there would be interrupted by the deadline rather
            // than merely stopped being waited on. It is given its first turn
            // before the quit moves on, so the work is under way from the
            // step that began it.
            Effect.zipRight(Ref.set(held, forked), Effect.yieldNow()),
          )
        : Effect.void,
    ),
    settled: Effect.flatMap(Ref.get(held), (running) =>
      running === undefined ? Effect.void : Effect.asVoid(running.await),
    ),
  }));
}

/**
 * The explicit quit's steps with the counted events' last flush folded in.
 * The flush begins the moment the door closes, so a count the client made
 * just before its quit (the update install it asked for) leaves alongside the
 * drain rather than after the process has gone; it is waited for only inside
 * the coordinator's one deadline, beside the runs settling, so a network that
 * stalls delays the quit by nothing more than the drain already allows, and
 * what did not settle is still counted from the persisted records without it.
 * The sender's own flush never fails; the guard here is for the shape, not
 * a case it has.
 */
export function shutdownStepsFlushingEvents(
  steps: GatewayShutdownSteps,
  flushEvents: Effect.Effect<void>,
): Effect.Effect<GatewayShutdownSteps> {
  return Effect.map(begunOnce(flushEvents), (flush) => ({
    closeAdmissions: Effect.zipRight(steps.closeAdmissions, flush.begin),
    cancelActive: steps.cancelActive,
    awaitSettled: Effect.all([steps.awaitSettled, flush.settled], {
      concurrency: "unbounded",
      discard: true,
    }),
    persistUnresolved: steps.persistUnresolved,
  }));
}

/**
 * The explicit quit's steps with the live voice session's graceful close
 * folded in. The close begins with the cancellations, so the session stops
 * taking appends the moment the runs stop, and is waited for only inside the
 * coordinator's one deadline beside them: a session whose final event never
 * comes delays the quit by nothing more than the drain already allows, and
 * its usage stands unconfirmed exactly as a lost connection's would. Nothing
 * of the session continues after an intentional quit.
 */
export function shutdownStepsClosingLiveSession(
  steps: GatewayShutdownSteps,
  closeSession: Effect.Effect<void>,
): Effect.Effect<GatewayShutdownSteps> {
  return Effect.map(begunOnce(closeSession), (close) => ({
    closeAdmissions: steps.closeAdmissions,
    cancelActive: Effect.zipRight(close.begin, steps.cancelActive),
    awaitSettled: Effect.all([steps.awaitSettled, close.settled], {
      concurrency: "unbounded",
      discard: true,
    }),
    persistUnresolved: steps.persistUnresolved,
  }));
}
