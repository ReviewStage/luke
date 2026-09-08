/**
 * How the Gateway leaves at an explicit quit, in a fixed order: the door
 * closes to new work, everything under way is cancelled, and the host waits
 * a bounded time for it to settle. What has not settled by then is persisted
 * as unresolved for the next launch's recovery and reported as such: a
 * shutdown never fabricates a completion for work it cut off, and an effect
 * whose outcome the cut left unknown stays unknown.
 */
import type { ScheduledTimer } from "../timers.js";

export const GATEWAY_SHUTDOWN_DEFAULTS = {
  DEADLINE_MS: 10_000,
} as const;

export interface GatewayShutdownSteps {
  closeAdmissions: () => void;
  /** Cancels everything under way; answers the ids of the runs it asked to stop. */
  cancelActive: () => Promise<readonly string[]>;
  /** Settles once no run is under way, or rejects/hangs, in which case the deadline decides. */
  awaitSettled: (signal: AbortSignal) => Promise<void>;
  /** Writes down whatever did not settle; answers how many records were left for recovery. */
  persistUnresolved: () => Promise<number>;
}

export interface GatewayShutdownOptions {
  deadlineMs?: number;
  now?: () => number;
  setTimeout?: (work: () => void, delayMs: number) => ScheduledTimer;
  clearTimeout?: (handle: ScheduledTimer) => void;
}

export interface GatewayShutdownReport {
  /** Whether every run under way settled before the deadline. */
  settled: boolean;
  cancelled: readonly string[];
  /** How many records were persisted unresolved for recovery. */
  unresolved: number;
  elapsedMs: number;
}

export async function shutdownGateway(
  steps: GatewayShutdownSteps,
  options: GatewayShutdownOptions = {},
): Promise<GatewayShutdownReport> {
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? ((work, ms) => setTimeout(work, ms));
  const cancel =
    options.clearTimeout ??
    ((handle) => {
      // SAFETY: a handle this default cancels is one the default scheduler above made, a Node timeout.
      clearTimeout(handle as NodeJS.Timeout);
    });
  const deadlineMs = options.deadlineMs ?? GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS;
  const startedAt = now();
  steps.closeAdmissions();
  // One deadline covers the cancellation and the settling both: a cancel
  // that hangs on a store or a run is as unbounded as a run that never
  // settles, and either leaves the Gateway standing past its quit.
  const controller = new AbortController();
  let timer: ScheduledTimer | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = schedule(() => {
      controller.abort();
      resolve(false);
    }, deadlineMs);
  });
  const cancelled = await Promise.race([
    steps.cancelActive().catch((): readonly string[] => []),
    deadline.then((): readonly string[] => []),
  ]);
  const settled = controller.signal.aborted
    ? false
    : await Promise.race([
        steps.awaitSettled(controller.signal).then(
          () => true,
          () => false,
        ),
        deadline,
      ]);
  if (timer !== undefined) cancel(timer);
  const unresolved = await steps.persistUnresolved();
  return { settled, cancelled, unresolved, elapsedMs: now() - startedAt };
}
