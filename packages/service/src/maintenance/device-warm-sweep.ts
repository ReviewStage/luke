/**
 * device-warm-sweep.ts -- the scheduled sweep's retire of an agent's runner left warm past its machine's window: a local agent's past its device's, and a cloud agent's past its sandbox's.
 *
 * A local agent's runner stays warm once its turn is over for as long as its
 * device's window (`CODER.RUNNER_WARM`), and the events route retires it as
 * its IDLE lands where that window is zero (`runnerIdled`). A retire that
 * failed there is logged and not retried, and a runner past a window that is
 * not zero is retired by nothing else, so it would end itself at its own idle
 * cap (`@repo/agent-runner`'s `RUNNER_WARM.IDLE_CAP_MS`), where a message its
 * host writes in that instant is lost. This sweep retires it first: it reads
 * every account's local agents whose newest launch is still open, on a device
 * that beat within its lease (a lapsed one's launches are settled at its
 * agent's next touch, `../agents/coder-host/lapsed-runner.ts`), and whose run ended longer ago than the larger of
 * the device's window and a short grace, which leaves the IDLE's own retire
 * to go first; or past the grace alone where the device last beat that it
 * waits to switch release (`HOST_UPDATE.WAITING`), so a host waiting to
 * update is not kept from it by a warm runner.
 *
 * A cloud agent's runner stays warm for its sandbox's window past the later
 * of its turn's end and the last time a client had it on screen
 * (`runner-sessions.ts`'s `warm`), and nothing but this sweep retires it, so
 * its sandbox, which the runner's heartbeat keeps alive, stops once the
 * developer left it. It reads every account's cloud agents whose record says
 * a runner runs (`agent-runner-record.ts`), whose newest turn ended, and
 * whose last use stands past that window, but within the runner's own idle
 * cap and the grace, past which the runner ended itself.
 *
 * Each is retired as the IDLE retires it (`retireWarmRunnerIfFree`): under
 * the agent's runner lease, the runner read again, nothing written where it
 * may have taken a message since, and its record cleared, a stop line on a
 * device, before the lease goes, so a message sent next relaunches it rather
 * than landing behind the retire. Its END then stops a sandbox as any
 * launch's end does. An agent whose runner lease another call holds is
 * passed by until the next minute rather than waited on, and a retire that
 * failed is logged by its kind and the rest still run.
 *
 * Every call is bounded so the sweep's minute holds: a set number of launches
 * read of each machine, retired a few at a time, each waiting at most a
 * moment on its runner's exit (`MAC_MACHINE.EXIT_WAIT`, `CODER.RUNNER_EXIT_READ`).
 */

import { RUNNER_WARM } from "@repo/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { warmCloudAgentLaunches } from "@repo/database/models/agent-runner-record";
import { warmDeviceAgentLaunches } from "@repo/database/models/device-agent-store";
import { AGENT_MACHINE, DEVICE_LEASE } from "@repo/features/agent-wire";
import { failureKind } from "@repo/runtime/effect";
import { Duration, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { agentLogIds } from "../agents/coder-host/agent-log.js";
import { CODER } from "../agents/coder-host/bounds.js";
import { retireWarmRunnerIfFree } from "../agents/coder-host/runner-sessions.js";

export const DEVICE_WARM_SWEEP = {
  /** How long after its run's newest turn ended a runner waits for its IDLE's own retire before the sweep retires it. */
  GRACE: Duration.minutes(2),
  /** The most warm launches one sweep reads of each machine; the rest wait for the next minute. */
  LIMIT: 20,
  /** How many retires run at once, since each waits on its runner's exit for a moment. */
  CONCURRENCY: 5,
} as const;

/** What one sweep of the warm local runners came to: runners retired, ones left warm because they took a message since, agents passed by behind another call's lease, and retires that failed. */
export interface DeviceWarmSweepOutcome {
  readonly retired: number;
  readonly left: number;
  readonly busy: number;
  readonly failed: number;
}

const WARM_ENDING = {
  RETIRED: "retired",
  /** The runner may have taken a message since its turn ended, or is no longer up. */
  LEFT: "left",
  /** Another call held the agent's runner lease. */
  BUSY: "busy",
  FAILED: "failed",
} as const;

type WarmEnding = (typeof WARM_ENDING)[keyof typeof WARM_ENDING];

/** A warm launch's runner as a retire names it: the agent's starter, the agent, and the session its place is found by. */
interface WarmLaunch {
  readonly userId: string;
  readonly agentId: string;
  readonly sessionId: string;
}

/** One warm launch's runner retired where it is still warm and its lease free, a failure logged by its kind alone. */
const retiredOne = (launch: WarmLaunch) =>
  retireWarmRunnerIfFree(launch).pipe(
    Effect.map((retired): WarmEnding => {
      if (Option.isNone(retired)) return WARM_ENDING.BUSY;
      return retired.value ? WARM_ENDING.RETIRED : WARM_ENDING.LEFT;
    }),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`a warm device runner was not retired: ${failureKind(failure)}`),
        WARM_ENDING.FAILED,
      ),
    ),
    Effect.annotateLogs(agentLogIds({ id: launch.agentId }, launch.sessionId)),
  );

/**
 * Retires the local agents' runners left warm past their device's window,
 * or past the grace on a device waiting to update, and the cloud agents'
 * left warm past their sandbox's, at most `limit` of each, as the header
 * says; answers what it came to.
 */
export const sweepDeviceWarmRunners = /* @__PURE__ */ Effect.fn("web/sweepDeviceWarmRunners")(
  function* (
    now: Date,
    limit: number = DEVICE_WARM_SWEEP.LIMIT,
  ): Effect.fn.Return<
    DeviceWarmSweepOutcome,
    StoreFailure,
    DatabaseServices | HttpClient.HttpClient
  > {
    const at = now.getTime();
    const grace = Duration.toMillis(DEVICE_WARM_SWEEP.GRACE);
    const window = Duration.toMillis(CODER.RUNNER_WARM[AGENT_MACHINE.DEVICE]);
    const cloudWindow = Duration.toMillis(CODER.RUNNER_WARM[AGENT_MACHINE.VERCEL]);
    const [devices, clouds] = yield* Effect.all(
      [
        warmDeviceAgentLaunches({
          seenSince: new Date(at - DEVICE_LEASE.MS),
          endedBefore: new Date(at - Math.max(window, grace)),
          waitingEndedBefore: new Date(at - grace),
          limit,
        }),
        warmCloudAgentLaunches({
          since: new Date(at - RUNNER_WARM.IDLE_CAP_MS - grace),
          before: new Date(at - cloudWindow),
          limit,
        }),
      ],
      { concurrency: "unbounded" },
    );
    const endings = yield* Effect.forEach([...devices, ...clouds], retiredOne, {
      concurrency: DEVICE_WARM_SWEEP.CONCURRENCY,
    });
    const count = (ending: WarmEnding) => endings.filter((each) => each === ending).length;
    return {
      retired: count(WARM_ENDING.RETIRED),
      left: count(WARM_ENDING.LEFT),
      busy: count(WARM_ENDING.BUSY),
      failed: count(WARM_ENDING.FAILED),
    };
  },
);
