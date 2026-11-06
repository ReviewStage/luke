import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { latestTurnsOf, readAgent } from "@repo/database/models/agent-store";
import {
  claimDeviceAgentLine,
  deviceAgentLineStanding,
  deviceAgentLinesWaiting,
  deviceAgentRequestsWaiting,
  latestDeviceAgentLaunch,
  settleDeviceAgentLine,
  withdrawExpiredDeviceAgentRows,
} from "@repo/database/models/device-agent-store";
import { beatDevice, deviceLayout } from "@repo/database/models/device-store";
import { openMacLaunchSecrets, parseKeyRing } from "@repo/database/models/provider-key-seal";
import { type StoreWriter, storeWriter } from "@repo/database/models/writer";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import {
  DEVICE_AGENT_LINE_KIND,
  type DeviceAgentLaunchSecrets,
  type DeviceLaunchUnstarted,
  deviceAgentLaunchSecretsSchema,
} from "@repo/features/device-agent-wire";
import { Clock, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import { TURN_ORIGIN } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { heldUntil } from "../http/held-read.js";
import type { StoreFailure } from "../http/store-failure.js";
import { launchStoppedDetail } from "./coder-host/status.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

export const DEVICE_AGENT_SERVICE = {
  HOLD: Duration.seconds(20),
  POLL: Duration.millis(500),
  EXPIRY: Duration.hours(26),
} as const;

type DeviceAgentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const decodeSecrets = Schema.decodeUnknownResult(
  Schema.fromJsonString(deviceAgentLaunchSecretsSchema),
);

export function deviceAgentDeviceOf(userId: string, deviceId: string): DeviceAgentEffect<boolean> {
  return Effect.map(deviceLayout(userId, deviceId), Option.isSome);
}

function heldRead<A>(
  userId: string,
  deviceId: string,
  waiting: DeviceAgentEffect<readonly A[]>,
): DeviceAgentEffect<readonly A[]> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* beatDevice(userId, deviceId);
    yield* withdrawExpiredDeviceAgentRows(
      userId,
      new Date(now - Duration.toMillis(DEVICE_AGENT_SERVICE.EXPIRY)),
    );
    const topics: readonly SyncTopic[] = [[TOPIC.ACCOUNT, userId]];
    const found = yield* heldUntil(
      waiting,
      (rows) => rows.length > 0,
      topics,
      DEVICE_AGENT_SERVICE.POLL,
      DEVICE_AGENT_SERVICE.HOLD,
    );
    return Option.match(found, { onNone: () => [], onSome: ({ read }) => read });
  });
}

export function deviceAgentLinesFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, deviceAgentLinesWaiting(userId, deviceId));
}

export function deviceAgentRequestsFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, deviceAgentRequestsWaiting(userId, deviceId));
}

const openedSecrets = (userId: string, agentId: string, sealed: string) =>
  Effect.gen(function* () {
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    const keys = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
    const ring = keys === undefined ? undefined : parseKeyRing(keys);
    if (ring === undefined || Result.isFailure(ring)) {
      yield* Effect.logWarning("a local agent's launch secrets found no key ring to open them");
      return Option.none<DeviceAgentLaunchSecrets>();
    }
    const opened = openMacLaunchSecrets(ring.success, { userId, agentId }, sealed);
    const read = Result.isSuccess(opened)
      ? decodeSecrets(Redacted.value(opened.success))
      : undefined;
    if (read === undefined || Result.isFailure(read)) {
      yield* Effect.logWarning("a local agent's launch secrets did not open");
      return Option.none<DeviceAgentLaunchSecrets>();
    }
    return Option.some(read.success);
  });

export function claimedDeviceAgentLine(
  userId: string,
  deviceId: string,
  id: string,
  claimToken?: string,
) {
  return Effect.gen(function* () {
    const claimed = yield* claimDeviceAgentLine(userId, deviceId, id, claimToken);
    if (Option.isNone(claimed)) return Option.none();
    const { sealedSecrets, secretsGone, ...line } = claimed.value;
    if (secretsGone) return Option.some({ line, secretsGone: true as const });
    if (line.kind !== DEVICE_AGENT_LINE_KIND.LAUNCH || sealedSecrets === null) {
      return Option.some({ line });
    }
    const secrets = yield* openedSecrets(userId, line.agentId, sealedSecrets);
    return Option.some(Option.isSome(secrets) ? { line, secrets: secrets.value } : { line });
  });
}

export const queuedUnopenedTurn = (
  writer: Pick<StoreWriter, "enqueueTurn">,
  userId: string,
  conversationId: string,
  launch: { readonly createdAt: Date; readonly stopped: boolean },
) =>
  Effect.gen(function* () {
    if (launch.stopped) return false;
    const newest = (yield* latestTurnsOf(userId, [conversationId])).get(conversationId);
    if (newest !== undefined && newest.queuedAt >= launch.createdAt) return false;
    const turnId = randomUUID();
    yield* writer.enqueueTurn(
      { userId, conversationId },
      { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
    );
    return true;
  });

export function settledDeviceAgentLine(
  userId: string,
  deviceId: string,
  id: string,
  exitCode?: number,
  unstarted?: DeviceLaunchUnstarted,
) {
  return Effect.gen(function* () {
    const fresh = yield* settleDeviceAgentLine(userId, deviceId, id, exitCode);
    const settled = Option.isSome(fresh)
      ? fresh
      : Option.filter(
          yield* deviceAgentLineStanding(userId, id),
          (standing) => standing.settled && standing.deviceId === deviceId,
        );
    if (Option.isNone(settled)) return false;
    const { agentId, kind } = settled.value;
    if (kind !== DEVICE_AGENT_LINE_KIND.LAUNCH) return true;
    const newest = yield* latestDeviceAgentLaunch(userId, agentId);
    if (Option.isNone(newest) || newest.value.id !== id) return true;
    const agent = yield* readAgent(userId, agentId);
    if (Option.isNone(agent)) return true;
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const unopened = yield* queuedUnopenedTurn(
      writer,
      userId,
      agent.value.conversationId,
      newest.value,
    );
    const detail = unopened ? launchStoppedDetail(newest.value.step, unstarted) : undefined;
    yield* settleRunnerLostTurns(
      writer,
      agent.value.conversationId,
      yield* Clock.currentTimeMillis,
      detail,
    );
    return true;
  });
}
