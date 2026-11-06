import {
  HOST_PAIRING_OUTCOME,
  type HostPairingOutcome,
  pollHostPairing,
  startHostPairing,
} from "@repo/features";
import type { DeviceArch, DeviceMachine, DevicePlatform } from "@repo/features/device-agent-wire";
import {
  HOST_PAIRING_POLL_STATUS,
  HOST_WIRE,
  type HostPairingPollAnswer,
  type HostPairingStartAnswer,
} from "@repo/features/host-wire";
import { Duration, Effect, Option, Ref, Schedule } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { readHostDevice, writeHostDevice } from "../host-device-record.js";

const SLOW_DOWN_STEP = Duration.seconds(5);

const COLLECT_GRACE = Duration.minutes(1);

export const HOST_CONNECT_OUTCOME = {
  CONNECTED: "connected",
  ALREADY_CONNECTED: "already-connected",
  DENIED: "denied",
  EXPIRED: "expired",
  BRAKED: "braked",
  UPGRADE_NEEDED: "upgrade-needed",
  REFUSED: "refused",
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

export type HostPairingCode = Omit<HostPairingStartAnswer, "pollSecret">;

export interface HostConnectInput {
  readonly stateRoot: string;
  readonly serviceOrigin: string;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly arch: DeviceArch;
  readonly machine: DeviceMachine;
  readonly version: string;
  readonly shown: (code: HostPairingCode) => Effect.Effect<void>;
}

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

function slowedDown(polled: HostPairingOutcome<HostPairingPollAnswer>): boolean {
  return (
    polled.outcome === HOST_PAIRING_OUTCOME.BRAKED ||
    (polled.outcome === HOST_PAIRING_OUTCOME.ANSWERED &&
      polled.answer.status === HOST_PAIRING_POLL_STATUS.SLOW_DOWN)
  );
}

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
    ...input.machine,
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

export const connectHostDevice = (input: HostConnectInput) =>
  connected(input).pipe(
    Effect.updateService(
      HttpClient.HttpClient,
      HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, input.version)),
    ),
  );
