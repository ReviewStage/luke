import type { GatewayShutdownSteps } from "@sidecar/gateway";

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
 * The explicit quit's steps with the counted events' last flush folded in.
 * The flush begins the moment the door closes, so a count the client made
 * just before its quit (the update install it asked for) leaves alongside the
 * drain rather than after the process has gone; it is waited for only inside
 * the coordinator's one deadline, beside the runs settling, so a network that
 * stalls delays the quit by nothing more than the drain already allows, and
 * what did not settle is still counted from the persisted records without it.
 * The sender's own flush never rejects; the guard here is for the shape, not
 * a case it has.
 */
export function shutdownStepsFlushingEvents(
  steps: GatewayShutdownSteps,
  flushEvents: () => Promise<void>,
): GatewayShutdownSteps {
  let flushing: Promise<void> | undefined;
  return {
    closeAdmissions: () => {
      steps.closeAdmissions();
      flushing ??= flushEvents().catch(() => undefined);
    },
    cancelActive: steps.cancelActive,
    awaitSettled: async (signal) => {
      await Promise.all([steps.awaitSettled(signal), flushing ?? Promise.resolve()]);
    },
    persistUnresolved: steps.persistUnresolved,
  };
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
  closeSession: () => Promise<void>,
): GatewayShutdownSteps {
  let closing: Promise<void> | undefined;
  return {
    closeAdmissions: steps.closeAdmissions,
    cancelActive: async () => {
      closing ??= closeSession().catch(() => undefined);
      return steps.cancelActive();
    },
    awaitSettled: async (signal) => {
      await Promise.all([steps.awaitSettled(signal), closing ?? Promise.resolve()]);
    },
    persistUnresolved: steps.persistUnresolved,
  };
}
