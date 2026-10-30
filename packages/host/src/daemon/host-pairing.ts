import {
  HOST_PAIRING_OUTCOME,
  type HostPairingOutcome,
  pollHostPairing,
  startHostPairing,
} from "@luke/features";
import type { DeviceArch, DevicePlatform } from "@luke/features/device-agent-wire";
import {
  HOST_PAIRING_POLL_STATUS,
  HOST_WIRE,
  type HostPairingPollAnswer,
  type HostPairingStartAnswer,
} from "@luke/features/host-wire";
import { Duration, Effect, Option, Ref, Schedule } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { readHostDevice, writeHostDevice } from "../host-device-record.js";

/**
 * host-pairing.ts -- a box connected to Luke with a code (`luke-host connect`): it starts a pairing, shows the code and the link that opens it, polls until a member approves or denies the code or it lapses, and once approved writes its record of the device (`../host-device-record.ts`) as an enroll does.
 *
 * The start carries no credential. The service answers a poll secret, which
 * names the pairing and nothing else, the code and its link, how long the
 * code lasts, and how often to poll (`@luke/features`' `startHostPairing`).
 * The box waits that long before each poll, and five seconds longer from
 * each time the service says to slow down, as RFC 8628's `slow_down` asks.
 * A poll that goes unanswered is tried again at the next, so a network blip
 * ends nothing; the box stops polling once the code and the service's grace
 * for collecting a secret have both passed. The first poll after an approve
 * is answered the device's id and secret, this once, so the record is
 * written whole before anything may interrupt it. A box whose record stands,
 * and which Luke has not refused, is connected already and starts nothing.
 * The poll secret and the device secret are never shown, logged, or reported.
 */

/** How much longer the box waits between polls each time the service says to slow down. */
const SLOW_DOWN_STEP = Duration.seconds(5);

/**
 * How long past its code's lifetime the box goes on polling: the service's
 * grace for a box to collect a secret approved at the last moment, after
 * which it answers expired anyway.
 */
const COLLECT_GRACE = Duration.minutes(1);

/** How a connect ended. */
export const HOST_CONNECT_OUTCOME = {
  /** A member approved the code, and the box's record is written. */
  CONNECTED: "connected",
  /** The box's record stands and Luke has not refused it, so no pairing was started. */
  ALREADY_CONNECTED: "already-connected",
  /** A member denied the code, or removed the host its approve made before the box collected it. */
  DENIED: "denied",
  /** The code lapsed before a member approved it. */
  EXPIRED: "expired",
  /** The service is starting no more pairings from the box's address for now. */
  BRAKED: "braked",
  /** The service refused the daemon's version as below its floor (`HOST_WIRE.VERSION_HEADER`). */
  UPGRADE_NEEDED: "upgrade-needed",
  /** The service refused the start or a poll for any other reason. */
  REFUSED: "refused",
  /** The start could not be answered: the network, the deadline, or a service answering something else. */
  UNANSWERED: "unanswered",
} as const;

type HostConnectOutcome =
  | { readonly outcome: typeof HOST_CONNECT_OUTCOME.CONNECTED; readonly deviceId: string }
  | {
      readonly outcome: typeof HOST_CONNECT_OUTCOME.ALREADY_CONNECTED;
      readonly serviceOrigin: string;
    }
  | {
      readonly outcome: typeof HOST_CONNECT_OUTCOME.UPGRADE_NEEDED;
      readonly minimumVersion?: string | undefined;
    }
  | {
      readonly outcome:
        | typeof HOST_CONNECT_OUTCOME.DENIED
        | typeof HOST_CONNECT_OUTCOME.EXPIRED
        | typeof HOST_CONNECT_OUTCOME.BRAKED
        | typeof HOST_CONNECT_OUTCOME.REFUSED
        | typeof HOST_CONNECT_OUTCOME.UNANSWERED;
    };

/** The code a box shows and the link that opens it, how long it lasts, and how often the box polls; never the poll secret. */
export type HostPairingCode = Omit<HostPairingStartAnswer, "pollSecret">;

export interface HostConnectInput {
  readonly stateRoot: string;
  readonly serviceOrigin: string;
  /** The box's own name, as the approve screen and the Hosts list show it. */
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  /** The daemon's version, which every call carries as every call of a host's does. */
  readonly version: string;
  /** Shows the code and its link, once the service answered them and before the first poll. */
  readonly shown: (code: HostPairingCode) => Effect.Effect<void>;
}

/** A start or poll the service did not answer, as how the connect ends. */
function endedBy(
  failed: Exclude<
    HostPairingOutcome<unknown>,
    { readonly outcome: typeof HOST_PAIRING_OUTCOME.ANSWERED }
  >,
): HostConnectOutcome {
  switch (failed.outcome) {
    case HOST_PAIRING_OUTCOME.BRAKED:
      return { outcome: HOST_CONNECT_OUTCOME.BRAKED };
    case HOST_PAIRING_OUTCOME.UPGRADE_NEEDED:
      return {
        outcome: HOST_CONNECT_OUTCOME.UPGRADE_NEEDED,
        minimumVersion: failed.minimumVersion,
      };
    case HOST_PAIRING_OUTCOME.REFUSED:
      return { outcome: HOST_CONNECT_OUTCOME.REFUSED };
    case HOST_PAIRING_OUTCOME.UNANSWERED:
      return { outcome: HOST_CONNECT_OUTCOME.UNANSWERED };
  }
}

/** Whether a poll leaves the box waiting: pending or told to slow down, braked, or unanswered. */
function waiting(polled: HostPairingOutcome<HostPairingPollAnswer>): boolean {
  switch (polled.outcome) {
    case HOST_PAIRING_OUTCOME.ANSWERED:
      return (
        polled.answer.status === HOST_PAIRING_POLL_STATUS.PENDING ||
        polled.answer.status === HOST_PAIRING_POLL_STATUS.SLOW_DOWN
      );
    case HOST_PAIRING_OUTCOME.BRAKED:
    case HOST_PAIRING_OUTCOME.UNANSWERED:
      return true;
    default:
      return false;
  }
}

/** Whether a poll asks the box to poll less often. */
function slowedDown(polled: HostPairingOutcome<HostPairingPollAnswer>): boolean {
  return (
    polled.outcome === HOST_PAIRING_OUTCOME.BRAKED ||
    (polled.outcome === HOST_PAIRING_OUTCOME.ANSWERED &&
      polled.answer.status === HOST_PAIRING_POLL_STATUS.SLOW_DOWN)
  );
}

/**
 * The pairing polled until it settles, each poll after the interval, longer
 * from each slow down; the last poll, or none once the code and its grace
 * passed with the box still waiting.
 */
const settledPoll = (serviceOrigin: string, started: HostPairingStartAnswer) =>
  Effect.gen(function* () {
    const interval = yield* Ref.make(Duration.millis(started.intervalMs));
    const polled = pollHostPairing(serviceOrigin, started.pollSecret).pipe(
      Effect.tap((answer) =>
        slowedDown(answer) ? Ref.update(interval, Duration.sum(SLOW_DOWN_STEP)) : Effect.void,
      ),
    );
    const schedule = Schedule.spaced(Duration.millis(started.intervalMs)).pipe(
      Schedule.modifyDelay(() => Ref.get(interval)),
    );
    return yield* polled.pipe(
      Effect.repeat({ schedule, until: (answer) => !waiting(answer) }),
      Effect.delay(Duration.millis(started.intervalMs)),
      Effect.timeoutOption(Duration.sum(Duration.millis(started.expiresInMs), COLLECT_GRACE)),
    );
  });

/** The box connected with a code: its record written once a member approves, or how the connect ended otherwise. */
const connected = Effect.fnUntraced(function* (input: HostConnectInput) {
  const kept = yield* readHostDevice(input.stateRoot);
  if (Option.isSome(kept) && kept.value.refused !== true) {
    return {
      outcome: HOST_CONNECT_OUTCOME.ALREADY_CONNECTED,
      serviceOrigin: kept.value.serviceOrigin,
    } satisfies HostConnectOutcome;
  }
  const started = yield* startHostPairing(input.serviceOrigin, {
    name: input.name,
    platform: input.platform,
    arch: input.arch,
  });
  if (started.outcome !== HOST_PAIRING_OUTCOME.ANSWERED) return endedBy(started);
  const { userCode, url, expiresInMs, intervalMs } = started.answer;
  yield* input.shown({ userCode, url, expiresInMs, intervalMs });
  const settled = yield* settledPoll(input.serviceOrigin, started.answer);
  if (Option.isNone(settled)) return { outcome: HOST_CONNECT_OUTCOME.EXPIRED } as const;
  const polled = settled.value;
  if (polled.outcome !== HOST_PAIRING_OUTCOME.ANSWERED) return endedBy(polled);
  const answer = polled.answer;
  switch (answer.status) {
    case HOST_PAIRING_POLL_STATUS.APPROVED:
      // Note that the secret is answered this once, so its record is written whole even where the connect is interrupted meanwhile.
      yield* writeHostDevice(input.stateRoot, {
        deviceId: answer.deviceId,
        deviceSecret: answer.deviceSecret,
        serviceOrigin: input.serviceOrigin,
      }).pipe(Effect.uninterruptible);
      return { outcome: HOST_CONNECT_OUTCOME.CONNECTED, deviceId: answer.deviceId } as const;
    case HOST_PAIRING_POLL_STATUS.DENIED:
      return { outcome: HOST_CONNECT_OUTCOME.DENIED } as const;
    default:
      return { outcome: HOST_CONNECT_OUTCOME.EXPIRED } as const;
  }
});

/**
 * The box connected to the service given with a code a member approves,
 * its daemon's version on every call; how the connect ended. A record that
 * cannot be written fails, since the secret the service answered once is
 * then lost.
 */
export const connectHostDevice = (input: HostConnectInput) =>
  connected(input).pipe(
    Effect.updateService(
      HttpClient.HttpClient,
      HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, input.version)),
    ),
  );
