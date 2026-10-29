/**
 * device-agent.ts -- what a local agent's Mac takes from the service: its lines and its requests, held for while none waits, and a launch line's secrets opened once as it is claimed.
 *
 * Every function is the Mac's side of `machine/device-machine.ts`, under the
 * account its sign-in token names and the device it names, and answers
 * nothing where the account has the `local-agents` experiment off or holds
 * no such Mac (`deviceAgentDeviceOf`). A held read counts as the Mac's beat,
 * withdraws the account's work queued too long ago for any Mac to take
 * (`DEVICE_AGENT_SERVICE.EXPIRY`, past the longest a coding agent's turn may
 * run), and answers what waits for that Mac as soon as anything does, or
 * nothing once the hold ends; it claims nothing, since the Mac claims each
 * row by its id. A launch line's claim hands its secrets over opened from
 * the row's seal, which the same claim cleared, so the Mac is handed them
 * once and the row never holds them again.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { settleRunnerLostTurns } from "@luke/database/models/abandoned-turns";
import { accountExperimentOn } from "@luke/database/models/account-store";
import { readAgent } from "@luke/database/models/agent-store";
import {
  claimDeviceAgentLine,
  deviceAgentLineStanding,
  deviceAgentLinesWaiting,
  deviceAgentRequestsWaiting,
  latestDeviceAgentLaunch,
  settleDeviceAgentLine,
  withdrawExpiredDeviceAgentRows,
} from "@luke/database/models/device-agent-store";
import { beatDevice, deviceLayout } from "@luke/database/models/device-store";
import { openMacLaunchSecrets, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { storeWriter } from "@luke/database/models/writer";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_LAUNCH_REFUSAL,
  type DeviceAgentLaunchSecrets,
  type DeviceLaunchRefusal,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLaunchSecretsSchema,
} from "@luke/features/device-agent-wire";
import { TURN_FAILURE } from "@luke/features/turn-run";
import { EXPERIMENT } from "@luke/settings";
import { Clock, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import { HostedEnvironment } from "../environment.js";
import { heldUntil } from "../http/held-read.js";
import type { StoreFailure } from "../http/store-failure.js";
import { RAN_DIRECTLY_DETAIL } from "./coder-host/status.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

export const DEVICE_AGENT_SERVICE = {
  /** How long the Mac's read is held while nothing waits for it. */
  HOLD: Duration.seconds(20),
  /** How often a held read looks again where Luke Sync cannot wake it. */
  POLL: Duration.millis(500),
  /**
   * How long a row may wait before it is withdrawn: past a coding agent's
   * longest turn (`TURN_ABANDON`'s twenty-five hours), so a line a Mac away
   * that long would take is one whose turn was already settled lost.
   */
  EXPIRY: Duration.hours(26),
} as const;

type DeviceAgentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const decodeSecrets = Schema.decodeUnknownResult(
  Schema.fromJsonString(deviceAgentLaunchSecretsSchema),
);

/**
 * Whether the account may follow the Mac it names: its `local-agents`
 * experiment is on and the Mac is its own. Every procedure of the Mac's
 * asks this first, and answers not found where it is false.
 */
export function deviceAgentDeviceOf(userId: string, deviceId: string): DeviceAgentEffect<boolean> {
  return Effect.gen(function* () {
    if (!(yield* accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS))) return false;
    return Option.isSome(yield* deviceLayout(userId, deviceId));
  });
}

/**
 * What a held read answers: the rows waiting, read again as each write to
 * the account's lines and requests lands, which notifies its topic
 * (`deviceAgentLineSync`, `deviceAgentRequestSync`), until any is or the
 * hold ends; the Mac beaten and the expired rows withdrawn first.
 */
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

/** The Mac's held read of its agents' lines, in their order. */
export function deviceAgentLinesFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, deviceAgentLinesWaiting(userId, deviceId));
}

/** The Mac's held read of its agents' tools' requests, oldest first. */
export function deviceAgentRequestsFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, deviceAgentRequestsWaiting(userId, deviceId));
}

/**
 * A launch line's secrets opened from the seal its claim took off the row,
 * bound to its account and agent; none where the deployment holds no ring
 * that opens it, which the log says by its kind alone.
 */
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

/**
 * One line claimed for the account's Mac under the token it minted for the
 * line, where it names one, with a launch line's secrets opened once; none
 * where it is not that Mac's, another claim took it, it was settled, or it
 * was withdrawn. The same claim asked again under the same token is
 * answered the line again, and a launch line's secrets as gone, since the
 * first claim took them. A launch line whose secrets do not open is handed
 * over without them, for the Mac to settle as a runner that never started.
 */
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

/** Where an agent's newest launch put its checkout, as its line's payload names it; nothing where it names none this service reads. */
const decodeLaunchPayload = Schema.decodeUnknownOption(deviceAgentLaunchPayloadSchema);

/** Why a launch its device refused to start failed, kept on the turn: the words of the refusal, and the folder the agent's work is still in. */
function refusalDetail(refusal: DeviceLaunchRefusal, checkoutPath: string | undefined): string {
  switch (refusal) {
    case DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY:
      return `${RAN_DIRECTLY_DETAIL}${checkoutPath ?? ""}`;
  }
}

/**
 * One line the account's Mac claimed, settled; whether it was. A launch
 * line that was the agent's newest settles its runner as gone, so a turn
 * of the agent's still under way, whose runner posted no END before it
 * ended, as when the app quit or the Mac's switch went off mid-turn, is
 * settled lost (`settleRunnerLostTurns`) and the agent offers Continue
 * rather than running until `TURN_ABANDON`. A launch the Mac settled unstarted
 * because the agent can never run there again (`refusal`) settles its turn
 * as a session that ended, so the agent reads as one only a new agent goes
 * on from. A turn the runner ended itself
 * is already settled, and is left as it stands. An older launch a newer one
 * replaced settles nothing of the newer one's turn.
 *
 * Note that a line this Mac already settled is answered as settled again,
 * and its runner's turn settled again, which settles nothing a second time,
 * because the line's own write and the turn's are two writes: a settle whose
 * turn write failed after its line's landed is asked again by the Mac, and
 * must still reach the turn.
 */
export function settledDeviceAgentLine(
  userId: string,
  deviceId: string,
  id: string,
  exitCode?: number,
  refusal?: DeviceLaunchRefusal,
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
    const now = yield* Clock.currentTimeMillis;
    yield* refusal === undefined
      ? settleRunnerLostTurns(writer, agent.value.conversationId, now)
      : settleRunnerLostTurns(
          writer,
          agent.value.conversationId,
          now,
          refusalDetail(
            refusal,
            Option.getOrUndefined(
              Option.map(decodeLaunchPayload(newest.value.payload), (each) => each.checkoutPath),
            ),
          ),
          undefined,
          TURN_FAILURE.SESSION_ENDED,
        );
    return true;
  });
}
