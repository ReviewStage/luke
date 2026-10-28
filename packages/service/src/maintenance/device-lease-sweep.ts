/**
 * device-lease-sweep.ts -- the scheduled sweep's end of a local agent's run once its device stopped beating.
 *
 * A device's beat is its lease on the runs it holds (`DEVICE_LEASE`), as a
 * self-hosted CI runner's is: a device that has not beaten for the lease
 * loses every launch it holds open, claimed or still waiting, loudly. Each
 * such launch is settled as its runner gone, under its agent's runner lease,
 * as every write to a local agent's lines is (`device-agent-store.ts`'s
 * header), and only while it is still open and its device still lapsed, so a
 * device that settled it or beat since keeps it. Where it was the agent's
 * newest launch, its runner's bearer is let go first, so nothing the runner
 * posts after reaches the agent again (the events intake, its tools, and its
 * token route all refuse a bearer the agent no longer records), and its turn
 * ends in words naming the device. A stop line follows, which a device that
 * comes back, a build from before the lease among them, takes after the
 * launch and ends the runner it no longer holds with; a follower holding no
 * runner for the agent settles it and does nothing.
 *
 * An agent whose runner lease another call holds is passed by until the
 * next minute rather than waited on, and a launch whose writes failed is
 * logged and the rest still run. Note that the line is settled before the
 * turn, because its guarded write is what decides the device lost the run;
 * a turn write that fails after it is left to `TURN_ABANDON`.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { settleRunnerLostTurns } from "@luke/database/models/abandoned-turns";
import {
  readCodingAgent,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import {
  type DeviceAgentLapsedLaunch,
  lapsedDeviceAgentLaunches,
  latestDeviceAgentLaunch,
  queueDeviceAgentLine,
  settleLapsedDeviceAgentLine,
} from "@luke/database/models/device-agent-store";
import type { StoreWriter } from "@luke/database/models/writer";
import { DEVICE_LEASE } from "@luke/features/coding-agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@luke/features/device-agent-wire";
import { Effect, Option } from "effect";
import { holdingRunnerIfFree } from "../agents/coder-host/runner-lease.js";

const DEVICE_LEASE_SWEEP = {
  /** The most launches one sweep settles; the rest wait for the next minute. */
  LIMIT: 50,
} as const;

/** What one sweep of the lapsed devices came to: runs taken from their device, agents passed by behind another call's lease, and launches whose writes failed. */
export interface DeviceLeaseSweepOutcome {
  readonly lapsed: number;
  readonly busy: number;
  readonly failed: number;
}

/** What the turn of a run its device lost says it failed of. */
function deviceAwayDetail(deviceName: string): string {
  return `${deviceName} went away during this turn. Send a message to carry on once it's back.`;
}

/** One lapsed launch taken from its device, its agent's runner lease held: whether this sweep settled it. */
const lapsedOne = (
  writer: Pick<StoreWriter, "consume">,
  launch: DeviceAgentLapsedLaunch,
  seenBefore: Date,
  now: number,
) =>
  Effect.gen(function* () {
    const { userId, agentId } = launch;
    const settled = yield* settleLapsedDeviceAgentLine(userId, launch.id, seenBefore);
    if (Option.isNone(settled)) return false;
    const newest = yield* latestDeviceAgentLaunch(userId, agentId);
    // An older launch a newer one replaced holds neither the bearer nor the turn under way.
    if (Option.isSome(newest) && newest.value.id === launch.id) {
      yield* recordCodingAgentRunnerToken(userId, agentId, null);
      const agent = yield* readCodingAgent(userId, agentId);
      if (Option.isSome(agent)) {
        yield* settleRunnerLostTurns(
          writer,
          agent.value.conversationId,
          now,
          deviceAwayDetail(launch.deviceName),
        );
      }
      if (newest.value.stopped) return true;
    }
    yield* queueDeviceAgentLine(userId, {
      agentId,
      kind: DEVICE_AGENT_LINE_KIND.STOP,
      payload: {},
    });
    return true;
  });

/**
 * Takes every launch still open of the devices that have not beaten within
 * `DEVICE_LEASE` from them, at most `limit`, as the header says; answers
 * what it came to.
 */
export const sweepDeviceLeases = /* @__PURE__ */ Effect.fn("web/sweepDeviceLeases")(function* (
  writer: Pick<StoreWriter, "consume">,
  options: { readonly now: number; readonly limit?: number | undefined },
): Effect.fn.Return<DeviceLeaseSweepOutcome, unknown, DatabaseServices> {
  const seenBefore = new Date(options.now - DEVICE_LEASE.MS);
  const launches = yield* lapsedDeviceAgentLaunches(
    seenBefore,
    options.limit ?? DEVICE_LEASE_SWEEP.LIMIT,
  );
  let lapsed = 0;
  let busy = 0;
  let failed = 0;
  for (const launch of launches) {
    const taken = yield* holdingRunnerIfFree(
      launch.agentId,
      lapsedOne(writer, launch, seenBefore, options.now),
    ).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`a lapsed device's launch was not settled: ${failure._tag}`),
          undefined,
        ),
      ),
    );
    if (taken === undefined) failed += 1;
    else if (Option.isNone(taken)) busy += 1;
    else if (taken.value) lapsed += 1;
  }
  return { lapsed, busy, failed };
});
