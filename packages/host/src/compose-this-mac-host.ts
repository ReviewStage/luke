import {
  type HostedDeviceAgentClient,
  OWN_ENROLL_OUTCOME,
  type OwnEnrollOutcome,
} from "@luke/features";
import { DEVICE_SETUP, type DeviceSetup } from "@luke/features/device-agent-wire";
import { HOST_WIRE } from "@luke/features/host-wire";
import { carried, GATEWAY_METHOD } from "@luke/gateway";
import { Clock, Duration, Effect, Option, type Path, Ref, Result, Semaphore } from "effect";
import type * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { THIS_MAC_HOST_STANDING, type ThisMacHostStanding } from "./contract/this-mac-host.js";
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
 * With the Local agents experiment on, the Mac is turned on in one
 * sequence, in order: the Mac is enrolled on the member's own sign-in
 * under the device id the account has on this Mac (`local-agent-state.ts`),
 * minted the first time (`enrollOwn`), which converts its device in place,
 * so its agents, folders and VMs carry over; its record is written where
 * `luke-host` reads it, the app's own state folder
 * (`host-device-record.ts`); the launches kept under the account are handed
 * to the device, whose follower settles them; and its login item is
 * registered (`ThisMacHost`). It runs as the app starts or the experiment
 * turns on, with nothing to switch, since a task runs here only where its
 * Runs on picks this Mac. Turning the experiment off unregisters the login
 * item and keeps the record, so turning it on again only registers it again.
 *
 * The record names the account the Mac runs agents for, the one whose
 * device id it carries, so another account signed in on the same Mac sees
 * it as another member's machine and turns nothing on or off. Luke refusing
 * the record's secret marks it refused (`@luke/host/daemon`), the Mac
 * removed in Settings, and nothing enrolls it again on its own: only the
 * member's own act does, Turn on again (`THIS_MAC_HOST_TURN_ON`). A turn-on
 * that failed says why and waits for the same act, Retry; the app never
 * follows the queue itself.
 *
 * `luke-host` fetches what its VMs run on once each time it starts, and
 * registers with the service whether that is still under way or failed, so
 * where it stands is read with the setup the service lists for this Mac. A
 * setup that failed waits for Retry, which starts `luke-host` again by
 * unregistering its login item and registering it again; so does Retry
 * after a failed turn-on. Nothing else starts it again, since a Mac whose
 * setup is ready may be mid-turn, and a setup the service could not say is
 * taken as not failed.
 *
 * It turns on beside a standalone `luke-host` the install command put on
 * this Mac, whichever account that one runs agents for: each keeps its own
 * state folder, and each agent's VM and folder are named for the agent.
 *
 * Where it stands is read again every `IDLE` while the account is signed
 * in: running while a follower holds the machine's lease, which only
 * `luke-host` can on a Mac, and otherwise as its login
 * item answers, registered and starting, or waiting for approval in System
 * Settings. The setup it carries is read at most every `SETUP_READ_EVERY`,
 * and only as Settings asks.
 */

/** How often where `luke-host` stands is read again. */
const IDLE = Duration.seconds(5);

/** How often Settings' read of this Mac asks the service again for the setup it registered. */
const SETUP_READ_EVERY = Duration.seconds(30);

/** What a failed turn-on says, by what failed. */
const FAILED_WORDS = {
  VERSION: "Luke couldn't start its host program on this Mac",
  NOT_FOUND: "Luke didn't find this Mac under your account. Retry.",
  UPGRADE_NEEDED:
    "Luke needs a newer version of this app to run agents here. Update Luke, then Retry.",
  UNANSWERED: "Luke couldn't be reached to add this Mac. Check your connection, then Retry.",
  REFUSED: "Luke refused to add this Mac",
  NOT_SAVED: "Luke couldn't save this Mac's sign-in in its state folder. Retry.",
  LOGIN_ITEM: "macOS refused Luke's login item",
  NO_LOGIN_ITEM: "This build of Luke carries no login item to run agents with.",
  NOT_STOPPED: "macOS didn't turn off Luke's login item, so agents may still be running here",
  SETUP: "Luke couldn't download what agents run on here",
} as const;

/** Where this Mac's setup stands as the service lists it: none for one that is ready. */
export interface ThisMacSetup {
  readonly setup?: DeviceSetup | undefined;
  readonly setupFailure?: string | undefined;
}

export interface ThisMacHostDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "hostedServiceBaseUrl" | "createId"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id; none where nobody is. */
  accountId: () => string | undefined;
  /** Whether the account's Local agents experiment is on. */
  switchedOn: Effect.Effect<boolean>;
  /** The setup the service lists for the device, by its id, nothing to say where it lists no such device; none where it could not answer. */
  deviceSetup: (
    deviceId: string,
  ) => Effect.Effect<Option.Option<ThisMacSetup>, never, HttpClient.HttpClient>;
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
  kind: Exclude<
    ThisMacHostStanding["standing"],
    typeof THIS_MAC_HOST_STANDING.FAILED | typeof THIS_MAC_HOST_STANDING.SETUP_FAILED
  >,
): ThisMacHostStanding => ({ standing: kind });

/** A standing of the device this Mac is enrolled as. */
const ofDevice = (next: ThisMacHostStanding, deviceId: string): ThisMacHostStanding => ({
  ...next,
  deviceId,
});

/** Whether the service says this Mac's setup failed; one it could not say is not. */
const setupFailed = (setup: Option.Option<ThisMacSetup>): boolean =>
  Option.isSome(setup) && setup.value.setup === DEVICE_SETUP.FAILED;

/** A standing that says `luke-host` is up, as its setup leaves it: getting ready, failed, or as it was. */
const withSetup = (
  next: ThisMacHostStanding,
  setup: Option.Option<ThisMacSetup>,
): ThisMacHostStanding => {
  const up =
    next.standing === THIS_MAC_HOST_STANDING.RUNNING ||
    next.standing === THIS_MAC_HOST_STANDING.NOT_RUNNING;
  if (!up || Option.isNone(setup)) return next;
  switch (setup.value.setup) {
    case DEVICE_SETUP.PREPARING:
      return { ...next, standing: THIS_MAC_HOST_STANDING.GETTING_READY };
    case DEVICE_SETUP.FAILED:
      return {
        ...next,
        standing: THIS_MAC_HOST_STANDING.SETUP_FAILED,
        reason: setup.value.setupFailure ?? FAILED_WORDS.SETUP,
      };
    case undefined:
      return next;
  }
};

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
    /** The setup last read for Settings, of which device, and when. */
    const setupRead = yield* Ref.make<
      { at: number; deviceId: string; setup: Option.Option<ThisMacSetup> } | undefined
    >(undefined);
    const reconciling = yield* Semaphore.make(1);

    const set = (next: ThisMacHostStanding) => Effect.as(Ref.set(standing, next), next);

    /** The enroll on the sign-in, with the version of the `luke-host` it enrolls for, naming the Mac as its `luke-host` registers it, so Luke creates the device where it never saw this Mac. */
    const enrolled = (deviceId: string, version: string) =>
      Effect.flatMap(host.machine, (machine) => client.enrollOwn(deviceId, machine)).pipe(
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
          return ofDevice(failed(`${FAILED_WORDS.LOGIN_ITEM}: ${registered.failure}`), deviceId);
        }
        report("this Mac's luke-host was enrolled and its login item registered");
        return ofDevice(registeredStanding(registered.success), deviceId);
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
     * The setup the service lists for the device, read now: none where it
     * could not answer. The read is kept for Settings, but for one that
     * could not answer, which keeps the setup last read, so a failure stays
     * drawn with its Retry through a service that cannot say.
     */
    const setupNow = (deviceId: string) =>
      Effect.gen(function* () {
        const setup = yield* dependencies.deviceSetup(deviceId);
        const kept = yield* Ref.get(setupRead);
        yield* Ref.set(setupRead, {
          at: yield* Clock.currentTimeMillis,
          deviceId,
          setup: Option.isNone(setup) && kept?.deviceId === deviceId ? kept.setup : setup,
        });
        return setup;
      });

    /** The setup Settings draws for the device: the one kept, read again where it is older than `SETUP_READ_EVERY`. */
    const setupShown = (deviceId: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const kept = yield* Ref.get(setupRead);
        if (
          kept === undefined ||
          kept.deviceId !== deviceId ||
          now - kept.at >= Duration.toMillis(SETUP_READ_EVERY)
        ) {
          yield* setupNow(deviceId);
        }
        return Option.flatMap(
          Option.fromUndefinedOr(yield* Ref.get(setupRead)),
          (read) => read.setup,
        );
      });

    /**
     * `luke-host` started again, its login item unregistered and registered,
     * so it fetches what its VMs run on again; the setup it failed is taken
     * as unread until the next read, since it has not registered again yet.
     */
    const restarted = (deviceId: string) =>
      Effect.gen(function* () {
        const unregistered = yield* host.loginItem(HOST_LOGIN_ITEM_ACT.UNREGISTER);
        if (Result.isFailure(unregistered)) {
          return failed(`${FAILED_WORDS.LOGIN_ITEM}: ${unregistered.failure}`);
        }
        const registered = yield* host.loginItem(HOST_LOGIN_ITEM_ACT.REGISTER);
        if (Result.isFailure(registered)) {
          return failed(`${FAILED_WORDS.LOGIN_ITEM}: ${registered.failure}`);
        }
        yield* Ref.set(setupRead, {
          at: yield* Clock.currentTimeMillis,
          deviceId,
          setup: Option.none(),
        });
        report("this Mac's luke-host was started again");
        return registeredStanding(registered.success);
      });

    /**
     * One read of where things stand, acted on: `explicit` is the member's
     * own Turn on again or Retry, the only thing besides the experiment
     * turned off and on that enrolls a removed Mac or tries a failed turn-on
     * again, and the only thing that starts `luke-host` again, where its
     * setup or the last turn-on failed.
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
          if (Option.isNone(record) || record.value.refused === true) {
            const next = yield* turnOn(userId);
            yield* Ref.set(turnOnFailed, next.standing === THIS_MAC_HOST_STANDING.FAILED);
            return yield* set(next);
          }
          const { deviceId } = record.value;
          // Note that only a turn-on or a setup that failed starts luke-host again, since one that is ready may be mid-turn.
          const restarts =
            explicit && ((yield* Ref.get(turnOnFailed)) || setupFailed(yield* setupNow(deviceId)));
          const next = restarts ? yield* restarted(deviceId) : yield* standingNow;
          yield* Ref.set(turnOnFailed, next.standing === THIS_MAC_HOST_STANDING.FAILED);
          return yield* set(ofDevice(next, deviceId));
        }),
      );

    const lifetime = Effect.gen(function* () {
      const guarded = Effect.catchDefect(Effect.provideContext(reconcile(false), services), () =>
        Effect.sync(() => report("this Mac's luke-host could not be read")),
      );
      yield* Effect.forkScoped(Effect.forever(Effect.andThen(guarded, Effect.sleep(IDLE))));
    });

    /** Where this Mac stands as Settings reads it: with the setup the service lists, where `luke-host` is up. */
    const read = (next: ThisMacHostStanding) =>
      next.deviceId === undefined
        ? Effect.succeed(next)
        : Effect.map(setupShown(next.deviceId), (setup) => withSetup(next, setup));

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.LOCAL_AGENTS> = {
      [GATEWAY_METHOD.THIS_MAC_HOST_READ]: () =>
        Effect.map(
          Effect.provideContext(Effect.flatMap(Ref.get(standing), read), services),
          carried,
        ),
      [GATEWAY_METHOD.THIS_MAC_HOST_TURN_ON]: () =>
        Effect.map(Effect.provideContext(Effect.flatMap(reconcile(true), read), services), carried),
    };
    return { methods, lifetime } satisfies Composer;
  });
}
