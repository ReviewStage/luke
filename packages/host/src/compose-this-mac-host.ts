import {
  type HostedDeviceAgentClient,
  OWN_ENROLL_OUTCOME,
  type OwnEnrollOutcome,
} from "@luke/features";
import { DEVICE_ARCH } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { carried, GATEWAY_METHOD } from "@luke/gateway";
import { Duration, Effect, Option, type Path, Ref, Result, Semaphore } from "effect";
import type * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { THIS_MAC_HOST_STANDING, type ThisMacHostStanding } from "./contract/this-mac-host.js";
import { DARWIN_HOST } from "./daemon/host-os.js";
import {
  HOST_LOGIN_ITEM_ACT,
  HOST_LOGIN_ITEM_STATUS,
  type HostLoginItemStatus,
  Reporter,
  ThisMacHost,
} from "./effect/seams.js";
import { followerLockHeld } from "./follower-lock.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import { readHostDevice, writeHostDevice } from "./host-device-record.js";
import type { HostKernel } from "./host-kernel.js";
import {
  localAgentDeviceOf,
  localAgentLaunchesHanded,
  localAgentOwnerOf,
} from "./local-agent-state.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-this-mac-host.ts -- This Mac's local agents run by `luke-host`, the same host program a Linux box runs, as the desktop app turns it on and off and shows where it stands.
 *
 * Turning Run agents on this Mac on, with the Local agents experiment, is
 * one sequence, in order: the Mac is enrolled on the member's own sign-in
 * under the device id the account has on this Mac (`local-agent-state.ts`),
 * minted the first time (`enrollOwn`), which converts its device in place,
 * so its agents, folders and VMs carry over; its record is written where
 * `luke-host` reads it, the app's own state folder
 * (`host-device-record.ts`); the launches kept under the account are handed
 * to the device, whose follower settles them; and its login item is
 * registered (`ThisMacHost`). Turning the switch off
 * unregisters the login item and keeps the record, so turning it on again
 * only registers it again: the switch is the pause.
 *
 * The record names the account the Mac runs agents for, the one whose
 * device id it carries, so another account signed in on the same Mac sees
 * it as another member's machine and turns nothing on or off. Luke refusing
 * the record's secret marks it refused (`@luke/host/daemon`), the Mac
 * removed in Settings, and nothing enrolls it again on its own: only the
 * member's own act does, Turn on again (`THIS_MAC_HOST_TURN_ON`) or the
 * switch turned off and on while the app watches. A turn-on that failed
 * says why and waits for the same act, Retry; the app never follows the
 * queue itself.
 *
 * Where it stands is read again every `IDLE` while the account is signed
 * in: running while a follower holds the machine's lease, which only
 * `luke-host` can on a Mac, and otherwise as its login
 * item answers, registered and starting, or waiting for approval in System
 * Settings.
 */

/** How often where `luke-host` stands is read again. */
const IDLE = Duration.seconds(5);

/** What a failed turn-on says, by what failed. */
const FAILED_WORDS = {
  VERSION: "Luke couldn't start its host program on this Mac",
  NOT_FOUND:
    "Luke didn't find this Mac under your account. Turn Run agents on this Mac off and on, or Retry.",
  UPGRADE_NEEDED:
    "Luke needs a newer version of this app to run agents here. Update Luke, then Retry.",
  UNANSWERED: "Luke couldn't be reached to add this Mac. Check your connection, then Retry.",
  REFUSED: "Luke refused to add this Mac",
  NOT_SAVED: "Luke couldn't save this Mac's sign-in in its state folder. Retry.",
  LOGIN_ITEM: "macOS refused Luke's login item",
  NO_LOGIN_ITEM: "This build of Luke carries no login item to run agents with.",
  NOT_STOPPED: "macOS didn't turn off Luke's login item, so agents may still be running here",
} as const;

export interface ThisMacHostDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "hostedServiceBaseUrl" | "createId"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id; none where nobody is. */
  accountId: () => string | undefined;
  /** Whether Run agents on this Mac and the account's Local agents experiment are both on. */
  switchedOn: Effect.Effect<boolean>;
  client: Pick<HostedDeviceAgentClient, "enrollOwn">;
}

type ThisMacHostServices =
  | Reporter
  | ThisMacHost
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;

const failed = (reason: string): ThisMacHostStanding => ({
  standing: THIS_MAC_HOST_STANDING.FAILED,
  reason,
});

const standingOf = (
  kind: Exclude<ThisMacHostStanding["standing"], typeof THIS_MAC_HOST_STANDING.FAILED>,
): ThisMacHostStanding => ({ standing: kind });

/** Where a registered login item leaves `luke-host`, as it answered. */
const registeredStanding = (status: HostLoginItemStatus): ThisMacHostStanding => {
  switch (status) {
    case HOST_LOGIN_ITEM_STATUS.REQUIRES_APPROVAL:
      return standingOf(THIS_MAC_HOST_STANDING.REQUIRES_APPROVAL);
    case HOST_LOGIN_ITEM_STATUS.NOT_FOUND:
      return failed(FAILED_WORDS.NO_LOGIN_ITEM);
    default:
      return standingOf(THIS_MAC_HOST_STANDING.NOT_RUNNING);
  }
};

/** What an enroll that took no secret says. */
const enrollFailure = (outcome: Exclude<OwnEnrollOutcome, { outcome: "enrolled" }>): string => {
  switch (outcome.outcome) {
    case OWN_ENROLL_OUTCOME.NOT_FOUND:
      return FAILED_WORDS.NOT_FOUND;
    case OWN_ENROLL_OUTCOME.UPGRADE_NEEDED:
      return FAILED_WORDS.UPGRADE_NEEDED;
    case OWN_ENROLL_OUTCOME.UNANSWERED:
      return FAILED_WORDS.UNANSWERED;
    case OWN_ENROLL_OUTCOME.REFUSED:
      return `${FAILED_WORDS.REFUSED} (${outcome.refusal}). Retry.`;
  }
};

export function composeThisMacHost(
  dependencies: ThisMacHostDependencies,
): Effect.Effect<Composer, never, ThisMacHostServices> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const host = yield* ThisMacHost;
    const services = yield* Effect.context<ThisMacHostServices>();
    const { kernel, account, client } = dependencies;
    const standing = yield* Ref.make<ThisMacHostStanding>(standingOf(THIS_MAC_HOST_STANDING.OFF));
    /** Whether the switch was on as it was last read; none before the first read, so an app start is no turn-on. */
    const lastOn = yield* Ref.make<boolean | undefined>(undefined);
    /** Whether the last turn-on failed, which only the member's own act tries again. */
    const turnOnFailed = yield* Ref.make(false);
    const reconciling = yield* Semaphore.make(1);

    const set = (next: ThisMacHostStanding) => Effect.as(Ref.set(standing, next), next);

    /** The enroll on the sign-in, with the version of the `luke-host` it enrolls for, naming the Mac as its `luke-host` registers it, so Luke creates the device where it never saw this Mac. */
    const enrolled = (deviceId: string, version: string) =>
      Effect.suspend(() =>
        client.enrollOwn(deviceId, {
          name: DARWIN_HOST.deviceName(),
          platform: DARWIN_HOST.platform,
          // Note that a Mac's luke-host runs on Apple silicon alone (`DARWIN_HOST.arches`).
          arch: DEVICE_ARCH.ARM64,
        }),
      ).pipe(
        Effect.updateService(
          HttpClient.HttpClient,
          HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, version)),
        ),
      );

    /**
     * The sequence: the Mac enrolled under the account's device id, its
     * record written, its launches handed to the device, and its login item
     * registered; where it then stands, or why it failed.
     */
    const turnOn = (userId: string) =>
      Effect.gen(function* () {
        yield* set(standingOf(THIS_MAC_HOST_STANDING.TURNING_ON));
        const deviceId = yield* localAgentDeviceOf(kernel.stateRoot, userId, kernel.createId);
        const version = yield* host.version;
        if (Result.isFailure(version)) return failed(`${FAILED_WORDS.VERSION}: ${version.failure}`);
        const outcome = yield* enrolled(deviceId, version.success);
        if (outcome.outcome !== OWN_ENROLL_OUTCOME.ENROLLED) return failed(enrollFailure(outcome));
        const saved = yield* Effect.result(
          writeHostDevice(kernel.stateRoot, {
            deviceId,
            deviceSecret: outcome.deviceSecret,
            serviceOrigin: kernel.hostedServiceBaseUrl,
          }),
        );
        if (Result.isFailure(saved)) return failed(FAILED_WORDS.NOT_SAVED);
        // Note that the launches the app kept are the device's only once it holds its secret, so a failed enroll strands none of them.
        if (!(yield* localAgentLaunchesHanded(kernel.stateRoot, userId, deviceId))) {
          report("the local agents' state could not be saved");
        }
        const registered = yield* host.loginItem(HOST_LOGIN_ITEM_ACT.REGISTER);
        if (Result.isFailure(registered)) {
          return failed(`${FAILED_WORDS.LOGIN_ITEM}: ${registered.failure}`);
        }
        report("this Mac's luke-host was enrolled and its login item registered");
        return registeredStanding(registered.success);
      });

    /** Where an enrolled `luke-host` stands: running while it holds the machine's lease, else as its login item answers, registered again where it was not. */
    const standingNow = Effect.gen(function* () {
      if (yield* followerLockHeld(kernel.stateRoot)) {
        return standingOf(THIS_MAC_HOST_STANDING.RUNNING);
      }
      const status = yield* host.loginItem(HOST_LOGIN_ITEM_ACT.STATUS);
      if (Result.isFailure(status)) return failed(`${FAILED_WORDS.LOGIN_ITEM}: ${status.failure}`);
      if (status.success !== HOST_LOGIN_ITEM_STATUS.NOT_REGISTERED) {
        return registeredStanding(status.success);
      }
      const registered = yield* host.loginItem(HOST_LOGIN_ITEM_ACT.REGISTER);
      return Result.isFailure(registered)
        ? failed(`${FAILED_WORDS.LOGIN_ITEM}: ${registered.failure}`)
        : registeredStanding(registered.success);
    });

    /**
     * One read of where things stand, acted on: `explicit` is the member's
     * own Turn on again or Retry, the only thing besides the switch turned
     * off and on that enrolls a removed Mac or tries a failed turn-on again.
     */
    const reconcile = (explicit: boolean) =>
      reconciling.withPermit(
        Effect.gen(function* () {
          const userId = dependencies.accountId();
          if (
            userId === undefined ||
            !account.capabilitiesActive() ||
            !kernel.runMode.sendsNetwork
          ) {
            return yield* set(standingOf(THIS_MAC_HOST_STANDING.OFF));
          }
          const on = yield* dependencies.switchedOn;
          const record = yield* readHostDevice(kernel.stateRoot);
          const owner = Option.isSome(record)
            ? yield* localAgentOwnerOf(kernel.stateRoot, record.value.deviceId)
            : undefined;
          // Note that another account's Mac is neither turned on nor off from here.
          if (Option.isSome(record) && owner !== userId) {
            return yield* set(
              standingOf(on ? THIS_MAC_HOST_STANDING.OTHER_ACCOUNT : THIS_MAC_HOST_STANDING.OFF),
            );
          }
          const wasOn = yield* Ref.get(lastOn);
          if (!on) {
            yield* Ref.set(turnOnFailed, false);
            if (Option.isSome(record) && wasOn !== false) {
              const unregistered = yield* host.loginItem(HOST_LOGIN_ITEM_ACT.UNREGISTER);
              // Note that the switch is not taken as off until the login item is, so the next read, or Retry, unregisters it again.
              if (Result.isFailure(unregistered)) {
                return yield* set(
                  failed(`${FAILED_WORDS.NOT_STOPPED} (${unregistered.failure}). Retry.`),
                );
              }
            }
            yield* Ref.set(lastOn, false);
            return yield* set(standingOf(THIS_MAC_HOST_STANDING.OFF));
          }
          yield* Ref.set(lastOn, true);
          const asked = explicit || wasOn === false;
          if ((yield* Ref.get(turnOnFailed)) && !asked) return yield* Ref.get(standing);
          if (Option.isSome(record) && record.value.refused === true && !asked) {
            return yield* set(standingOf(THIS_MAC_HOST_STANDING.REMOVED));
          }
          const next =
            Option.isNone(record) || record.value.refused === true
              ? yield* turnOn(userId)
              : yield* standingNow;
          yield* Ref.set(turnOnFailed, next.standing === THIS_MAC_HOST_STANDING.FAILED);
          return yield* set(next);
        }),
      );

    const lifetime = Effect.gen(function* () {
      const guarded = Effect.catchDefect(Effect.provideContext(reconcile(false), services), () =>
        Effect.sync(() => report("this Mac's luke-host could not be read")),
      );
      yield* Effect.forkScoped(Effect.forever(Effect.andThen(guarded, Effect.sleep(IDLE))));
    });

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.LOCAL_AGENTS> = {
      [GATEWAY_METHOD.THIS_MAC_HOST_READ]: () => Effect.map(Ref.get(standing), carried),
      [GATEWAY_METHOD.THIS_MAC_HOST_TURN_ON]: () =>
        Effect.map(Effect.provideContext(reconcile(true), services), carried),
    };
    return { methods, lifetime } satisfies Composer;
  });
}
