/**
 * mac-agent.ts -- what a local agent's Mac takes from the service: its lines and its requests, held for while none waits, and a launch line's secrets opened once as it is claimed.
 *
 * Every function is the Mac's side of `machine/mac-machine.ts`, under the
 * account its sign-in token names and the device it names, and answers
 * nothing where the account has the `local-agents` experiment off or holds
 * no such Mac (`macAgentDeviceOf`). A held read counts as the Mac's beat,
 * withdraws the account's work queued too long ago for any Mac to take
 * (`MAC_AGENT_SERVICE.EXPIRY`, past the longest a coding agent's turn may
 * run), and answers what waits for that Mac as soon as anything does, or
 * nothing once the hold ends; it claims nothing, since the Mac claims each
 * row by its id. A launch line's claim hands its secrets over opened from
 * the row's seal, which the same claim cleared, so the Mac is handed them
 * once and the row never holds them again.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  claimMacAgentLine,
  macAgentLinesWaiting,
  macAgentRequestsWaiting,
  withdrawExpiredMacAgentRows,
} from "@luke/database/models/mac-agent-store";
import { beatMacDevice, macDeviceLayout } from "@luke/database/models/mac-device-store";
import { openMacLaunchSecrets, parseKeyRing } from "@luke/database/models/provider-key-seal";
import {
  MAC_AGENT_LINE_KIND,
  type MacAgentLaunchSecrets,
  macAgentLaunchSecretsSchema,
} from "@luke/features/mac-agent-wire";
import { EXPERIMENT } from "@luke/settings";
import { Clock, Duration, Effect, Option, Redacted, Result, Schedule, Schema } from "effect";
import { HostedEnvironment } from "../environment.js";
import type { StoreFailure } from "../http/store-failure.js";

export const MAC_AGENT_SERVICE = {
  /** How long the Mac's read is held while nothing waits for it. */
  HOLD: Duration.seconds(20),
  /** How often a held read looks again. */
  POLL: Duration.millis(500),
  /**
   * How long a row may wait before it is withdrawn: past a coding agent's
   * longest turn (`TURN_ABANDON`'s twenty-five hours), so a line a Mac away
   * that long would take is one whose turn was already settled lost.
   */
  EXPIRY: Duration.hours(26),
} as const;

type MacAgentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const decodeSecrets = Schema.decodeUnknownResult(
  Schema.fromJsonString(macAgentLaunchSecretsSchema),
);

/**
 * Whether the account may follow the Mac it names: its `local-agents`
 * experiment is on and the Mac is its own. Every procedure of the Mac's
 * asks this first, and answers not found where it is false.
 */
export function macAgentDeviceOf(userId: string, deviceId: string): MacAgentEffect<boolean> {
  return Effect.gen(function* () {
    if (!(yield* accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS))) return false;
    return Option.isSome(yield* macDeviceLayout(userId, deviceId));
  });
}

/** What a held read answers: the rows waiting, read again until any is or the hold ends; the Mac beaten and the expired rows withdrawn first. */
function heldRead<A>(
  userId: string,
  deviceId: string,
  waiting: MacAgentEffect<readonly A[]>,
): MacAgentEffect<readonly A[]> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* beatMacDevice(userId, deviceId);
    yield* withdrawExpiredMacAgentRows(
      userId,
      new Date(now - Duration.toMillis(MAC_AGENT_SERVICE.EXPIRY)),
    );
    const found = yield* waiting.pipe(
      Effect.repeat({
        schedule: Schedule.spaced(MAC_AGENT_SERVICE.POLL),
        until: (rows) => rows.length > 0,
      }),
      Effect.timeoutOption(MAC_AGENT_SERVICE.HOLD),
    );
    return Option.getOrElse(found, () => []);
  });
}

/** The Mac's held read of its agents' lines, in their order. */
export function macAgentLinesFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, macAgentLinesWaiting(userId, deviceId));
}

/** The Mac's held read of its agents' tools' requests, oldest first. */
export function macAgentRequestsFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, macAgentRequestsWaiting(userId, deviceId));
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
      return Option.none<MacAgentLaunchSecrets>();
    }
    const opened = openMacLaunchSecrets(ring.success, { userId, agentId }, sealed);
    const read = Result.isSuccess(opened)
      ? decodeSecrets(Redacted.value(opened.success))
      : undefined;
    if (read === undefined || Result.isFailure(read)) {
      yield* Effect.logWarning("a local agent's launch secrets did not open");
      return Option.none<MacAgentLaunchSecrets>();
    }
    return Option.some(read.success);
  });

/**
 * One line claimed for the account's Mac, with a launch line's secrets
 * opened once; none where it is not that Mac's, another claim took it, or
 * it was withdrawn. A launch line whose secrets do not open is handed over
 * without them, for the Mac to settle as a runner that never started.
 */
export function claimedMacAgentLine(userId: string, deviceId: string, id: string) {
  return Effect.gen(function* () {
    const claimed = yield* claimMacAgentLine(userId, deviceId, id);
    if (Option.isNone(claimed)) return Option.none();
    const { sealedSecrets, ...line } = claimed.value;
    if (line.kind !== MAC_AGENT_LINE_KIND.LAUNCH || sealedSecrets === null) {
      return Option.some({ line });
    }
    const secrets = yield* openedSecrets(userId, line.agentId, sealedSecrets);
    return Option.some(Option.isSome(secrets) ? { line, secrets: secrets.value } : { line });
  });
}
