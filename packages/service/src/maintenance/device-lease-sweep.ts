import type { DatabaseServices } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { readAgent, recordAgentRunnerToken } from "@repo/database/models/agent-store";
import {
  type DeviceAgentLapsedLaunch,
  lapsedDeviceAgentLaunches,
  latestDeviceAgentLaunch,
  queueDeviceAgentLine,
  settleLapsedDeviceAgentLine,
} from "@repo/database/models/device-agent-store";
import type { StoreWriter } from "@repo/database/models/writer";
import { DEVICE_LEASE } from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@repo/features/device-agent-wire";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { holdingRunnerIfFree } from "../agents/coder-host/runner-lease.js";
import { hostAwayDetail } from "../agents/coder-host/status.js";
import { queuedUnopenedTurn } from "../agents/device-agent.js";

const DEVICE_LEASE_SWEEP = {
  LIMIT: 50,
} as const;

export interface DeviceLeaseSweepOutcome {
  readonly lapsed: number;
  readonly busy: number;
  readonly failed: number;
}

const lapsedOne = (
  writer: Pick<StoreWriter, "consume" | "enqueueTurn">,
  launch: DeviceAgentLapsedLaunch,
  seenBefore: Date,
  now: number,
) =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const { userId, agentId } = launch;
        const settled = yield* settleLapsedDeviceAgentLine(userId, launch.id, seenBefore);
        if (Option.isNone(settled)) return false;
        const newest = yield* latestDeviceAgentLaunch(userId, agentId);
        if (Option.isNone(newest) || newest.value.id !== launch.id) return true;
        yield* recordAgentRunnerToken(userId, agentId, null);
        const agent = yield* readAgent(userId, agentId);
        if (Option.isSome(agent)) {
          yield* queuedUnopenedTurn(writer, userId, agent.value.conversationId, newest.value);
          yield* settleRunnerLostTurns(
            writer,
            agent.value.conversationId,
            now,
            hostAwayDetail(launch.deviceName),
          );
        }
        if (!newest.value.stopped) {
          yield* queueDeviceAgentLine(userId, {
            agentId,
            kind: DEVICE_AGENT_LINE_KIND.STOP,
            payload: {},
          });
        }
        return true;
      }),
    ),
  );

export const sweepDeviceLeases = /* @__PURE__ */ Effect.fn("web/sweepDeviceLeases")(function* (
  writer: Pick<StoreWriter, "consume" | "enqueueTurn">,
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
