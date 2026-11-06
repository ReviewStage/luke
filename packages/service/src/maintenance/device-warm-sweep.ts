import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  type DeviceAgentWarmLaunch,
  warmDeviceAgentLaunches,
} from "@repo/database/models/device-agent-store";
import { AGENT_MACHINE, DEVICE_LEASE } from "@repo/features/agent-wire";
import { failureKind } from "@repo/runtime/effect";
import { Duration, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { agentLogIds } from "../agents/coder-host/agent-log.js";
import { CODER } from "../agents/coder-host/bounds.js";
import { retireWarmRunnerIfFree } from "../agents/coder-host/runner-sessions.js";

export const DEVICE_WARM_SWEEP = {
  GRACE: Duration.minutes(2),
  LIMIT: 20,
  CONCURRENCY: 5,
} as const;

export interface DeviceWarmSweepOutcome {
  readonly retired: number;
  readonly left: number;
  readonly busy: number;
  readonly failed: number;
}

const WARM_ENDING = {
  RETIRED: "retired",
  LEFT: "left",
  BUSY: "busy",
  FAILED: "failed",
} as const;

type WarmEnding = (typeof WARM_ENDING)[keyof typeof WARM_ENDING];

const retiredOne = (launch: DeviceAgentWarmLaunch) =>
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
    const launches = yield* warmDeviceAgentLaunches({
      seenSince: new Date(at - DEVICE_LEASE.MS),
      endedBefore: new Date(at - Math.max(window, grace)),
      waitingEndedBefore: new Date(at - grace),
      limit,
    });
    const endings = yield* Effect.forEach(launches, retiredOne, {
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
