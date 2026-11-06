import { type HostedDeviceAgentClient, OWN_ENROLL_OUTCOME } from "@repo/features";
import { AGENT_CALL_FAILURE, thisMacHostSetParamsSchema } from "@repo/features/agent-view";
import { HOST_RELEASE } from "@repo/features/host-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, readParams } from "@repo/gateway";
import { EXPERIMENT, type Experiment } from "@repo/settings";
import {
  Duration,
  Effect,
  MutableRef,
  Option,
  type Path,
  Result,
  Schedule,
  Semaphore,
  Stream,
} from "effect";
import type * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { ChildProcessSpawner } from "effect/process";
import { type AppThisMacHost, type AppThisMacHosts, NO_KEYS_HELD } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Reporter, ThisMacHost } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import {
  type HostDevice,
  readHostDevice,
  removeHostDevice,
  writeHostDevice,
} from "./host-device-record.js";
import type { HostKernel } from "./host-kernel.js";
import { forgetOwnedAgents, ownedAgents } from "./local-agent-state.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-this-mac-host.ts -- This Mac's host, the account install the install command puts on a Mac, kept running while the account has Bring your own host on and stopped while it has it off.
 *
 * There is one such install on a Mac, under the member's own home
 * (`ThisMacHost`'s `stateRoot`, `~/.local/state/vespin-host`), so every build
 * of the app, released, Test, development, and each named instance, reads
 * and controls the same host. Where it stands is read again every `IDLE`,
 * and acted on only when it changed: at launch, at sign-in, and when Bring
 * your own host is turned on or off. While no account is signed in, nothing
 * on this Mac is installed, started, or stopped.
 *
 * This Mac runs agents only where the member turned it on: Settings ›
 * Hosts' Run agents on this Mac (`HOSTS_THIS_MAC_SET`), whose switch reads
 * the record itself, on while one of the account's stands unrefused, so
 * there is no setting beside it to agree with. Turning it on enrolls the
 * Mac on the member's own sign-in (`enrollOwn`), under the record's device
 * id where a refused one has it, so a removed host comes back as itself,
 * and under an id minted here where there is none; its record is written
 * where the install's host reads it, and the install script the service
 * serves is run, which installs or upgrades the release, loads its
 * LaunchAgent, and starts the host, whose `connect` answers at once as
 * connected. Turning it off runs the install's own `vespin-host uninstall`,
 * which takes the host out of the account and off this Mac, as Remove
 * anywhere else has the host do itself. Nothing here enrolls a Mac
 * unasked, so a Mac removed from anywhere stays off until it is turned on.
 * With Bring your own host on, a host of the account standing is kept
 * running, started where launchd no longer holds it, the script run again
 * over the record it stands on. With Bring your own host off, a host of the
 * account is stopped and kept from starting at the next login, its
 * releases, state, record and agents' folders kept, so turning it on again
 * starts the same host on the same record.
 *
 * A record is the account's where the service lists its device among the
 * account's hosts; another account's, or one enrolled with another service
 * than the app's, as a development build pointed at a Preview would see, is
 * left alone, since there is only one such install on a Mac. Note that the
 * Mac is enrolled only where no host of the account stands, because an
 * enroll keys the device again and refuses the secret its host runs on; so
 * once a record stands, a step that failed is tried again by running the
 * script again, never by enrolling. A step that failed is tried again after
 * `RETRY`, for as long as what the app keeps the host at stands, and nothing
 * is shown of it: launchd and the host's own setup carry the rest. A Mac the
 * host cannot run on (`ThisMacHost`'s `runsHost`) is never enrolled.
 *
 * Which machine this Mac is, and the device its record names, are told to
 * the windows under the account signed in (`LIVE_READ.THIS_MAC_HOST`) as
 * the host starts, after its own enroll, and on every pass of `IDLE` where
 * either or the account moved, so a record the install's own host writes
 * as it pairs, or once its secret is refused, reaches them within a pass
 * whether or not a window draws a machine.
 */

/** How often what the app keeps This Mac's host at is read again. */
const IDLE = Duration.seconds(5);

/** How soon a step that failed is tried again: from `FIRST`, twice as long each time, never longer than `LONGEST`. */
const RETRY_AFTER = {
  FIRST: Duration.seconds(10),
  LONGEST: Duration.hours(1),
} as const;

const RETRY = Schedule.exponential(RETRY_AFTER.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, RETRY_AFTER.LONGEST)),
  ),
);

/** What the app keeps This Mac's host at for the account signed in, and how many times it was turned on; none where it keeps it at nothing, and leaves it as it stands. */
type Kept =
  | { readonly userId: string; readonly running: boolean; readonly turns: number }
  | undefined;

const sameKept = (one: Kept, other: Kept) =>
  one?.userId === other?.userId && one?.running === other?.running && one?.turns === other?.turns;

/** Whether two reads of This Mac name the same device and machine, and stand the same. */
const sameThisMac = (one: AppThisMacHost, other: AppThisMacHost) =>
  one.deviceId === other.deviceId &&
  one.machineId === other.machineId &&
  one.enrolled === other.enrolled &&
  one.agentFolders === other.agentFolders;

/** What turning This Mac on or off answers: done, or that it could not be. */
const DONE = { done: true } as const;
const UNDONE = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

export interface ThisMacHostDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "createId" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id; none where nobody is. */
  accountId: () => string | undefined;
  /** Whether the account signed in has the experiment given on, as the settings hold it now. */
  experimentOn: (experiment: Experiment) => Effect.Effect<boolean>;
  /** Whether the service lists the device given among the account's hosts; none where it could not answer. */
  hostListed: (
    deviceId: string,
  ) => Effect.Effect<Option.Option<boolean>, never, HttpClient.HttpClient>;
  client: Pick<HostedDeviceAgentClient, "enrollOwn">;
}

type ThisMacHostServices =
  | Reporter
  | ThisMacHost
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;

export function composeThisMacHost(
  dependencies: ThisMacHostDependencies,
): Effect.Effect<Composer, never, ThisMacHostServices> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const host = yield* ThisMacHost;
    const services = yield* Effect.context<ThisMacHostServices>();
    const { kernel, account, client } = dependencies;
    const serviceOrigin = new URL(kernel.hostedServiceBaseUrl).origin;

    /** Whether the record was enrolled with this app's service; one enrolled with another is left alone. */
    const ownService = (record: HostDevice) =>
      URL.canParse(record.serviceOrigin) && new URL(record.serviceOrigin).origin === serviceOrigin;

    const ownServiceRecord = Effect.map(readHostDevice(host.stateRoot), Option.filter(ownService));

    // Note that which machine this is never changes, so it is read once, as This Mac is first told.
    const machineId = yield* Effect.cached(
      Effect.map(host.machine, (machine) => machine.machineId),
    );

    /** This Mac as the windows draw it: which machine it is, the device its record names, where it was enrolled with this app's service, whether it stands unrefused, and how many agents' folders its host made. */
    const read = Effect.map(
      Effect.all([ownServiceRecord, machineId, ownedAgents(host.stateRoot)]),
      ([record, id, folders]): AppThisMacHost => ({
        ...(Option.isSome(record) ? { deviceId: record.value.deviceId } : undefined),
        ...(id === undefined ? undefined : { machineId: id }),
        enrolled: Option.isSome(record) && record.value.refused !== true,
        agentFolders: folders.length,
      }),
    );

    /** This Mac as last told the windows, and the account it was told under; none before the first. */
    let told: { readonly userId: string | undefined; readonly thisMac: AppThisMacHost } | undefined;

    /** This Mac told the windows under the account signed in, where it or the account moved since it was last told; nothing is held while nobody is signed in. */
    const tellThisMac = Effect.gen(function* () {
      const userId = dependencies.accountId();
      const thisMac = yield* read;
      if (told !== undefined && told.userId === userId && sameThisMac(told.thisMac, thisMac))
        return;
      told = { userId, thisMac };
      const held: AppThisMacHosts =
        userId === undefined ? NO_KEYS_HELD : { [userId]: { rows: thisMac } };
      kernel.emit(GATEWAY_EVENT.THIS_MAC_HOST_CHANGED, carried(held));
    });

    /** Whether the record's device is the account's, as the service lists its hosts. */
    const accountOwns = (record: HostDevice) =>
      Effect.flatMap(dependencies.hostListed(record.deviceId), (listed) =>
        Option.isSome(listed)
          ? Effect.succeed(listed.value)
          : Effect.fail("read the account's hosts"),
      );

    /**
     * The Mac enrolled under the device id given, or one minted, on the
     * version of the release the script installs, and its record written;
     * whether it was, false where the id is another account's. Note that it
     * runs whole once begun, since the service answers the secret once.
     */
    const enrolled = (kept: Option.Option<string>, version: string) =>
      Effect.gen(function* () {
        const deviceId = Option.getOrElse(kept, kernel.createId);
        const outcome = yield* client
          .enrollOwn(deviceId, yield* host.machine)
          .pipe(
            Effect.updateService(
              HttpClient.HttpClient,
              HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, version)),
            ),
          );
        if (outcome.outcome === OWN_ENROLL_OUTCOME.NOT_FOUND) return false;
        if (outcome.outcome !== OWN_ENROLL_OUTCOME.ENROLLED) return yield* Effect.fail("enroll it");
        yield* writeHostDevice(host.stateRoot, {
          deviceId,
          deviceSecret: outcome.deviceSecret,
          serviceOrigin,
        }).pipe(Effect.mapError(() => "save its record"));
        report("this Mac's host was enrolled");
        yield* tellThisMac;
        return true;
      }).pipe(Effect.uninterruptible);

    /** The install script the service serves, run: the release installed or upgraded and the host started. */
    const installed = Effect.gen(function* () {
      const script = yield* HttpClient.get(
        new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, serviceOrigin).href,
      ).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.text),
        Effect.mapError(() => "read its install script"),
      );
      const ran = yield* host.install(script);
      if (Result.isFailure(ran)) return yield* Effect.fail(`install it: ${ran.failure}`);
      report("this Mac's host was installed and started");
    });

    // Note that keeping the host running and turning This Mac off take turns, so an install under way finishes before an uninstall begins, and one asked after reads the record the uninstall left.
    const oneAtATime = (yield* Semaphore.make(1)).withPermits(1);

    /** The account's host running where it stands, the script run where launchd holds none; nothing is enrolled here, since only turning This Mac on enrolls it. */
    const keepRunning = oneAtATime(
      Effect.gen(function* () {
        if (HOST_RELEASE === undefined || !host.runsHost) return;
        const record = yield* ownServiceRecord;
        if (Option.isNone(record) || record.value.refused === true) return;
        if (!(yield* accountOwns(record.value)) || (yield* host.loaded)) return;
        yield* installed;
      }),
    );

    /** How many times This Mac was turned on, which the loop reads so a turn on is kept running, the script run after its enroll. */
    const turns = MutableRef.make(0);

    /** This Mac turned on: enrolled where none of the account's stands unrefused, never over another account's standing host; whether it is on. */
    const turnedOn = oneAtATime(
      Effect.gen(function* () {
        if (HOST_RELEASE === undefined || !host.runsHost) return false;
        const record = yield* readHostDevice(host.stateRoot);
        if (Option.isSome(record) && !ownService(record.value)) return false;
        if (Option.isSome(record) && record.value.refused !== true) {
          return yield* accountOwns(record.value);
        }
        const deviceId = Option.map(record, (kept) => kept.deviceId);
        if (!(yield* enrolled(deviceId, HOST_RELEASE.VERSION))) return false;
        MutableRef.update(turns, (count) => count + 1);
        return true;
      }),
    ).pipe(
      Effect.catch((step) =>
        Effect.sync(() => {
          report(`this Mac's host: could not ${step}`);
          return false;
        }),
      ),
    );

    /**
     * This Mac turned off, its agents' folders deleted or kept as asked: the
     * install's own uninstall run, which takes the host off this Mac and out
     * of the account, and the record removed where no install was there to
     * remove it. Never another account's host. Note that kept folders are
     * kept by letting go of the
     * record of which ones the host made, which every release's uninstall
     * reads to find them. Whether it is off.
     */
    const turnedOff = (deleteFolders: boolean) =>
      oneAtATime(
        Effect.gen(function* () {
          if (!host.runsHost) return false;
          const record = Option.filter(yield* ownServiceRecord, (kept) => kept.refused !== true);
          if (Option.isSome(record) && !(yield* accountOwns(record.value))) return false;
          // Note that we stop the host before forgetting its folders, because a running host marks each agent's folder it makes, and the uninstall deletes every marked one.
          if (!deleteFolders) {
            const stopped = yield* host.stop;
            if (Result.isFailure(stopped)) {
              report(`this Mac's host could not be stopped: ${stopped.failure}`);
              return false;
            }
            yield* forgetOwnedAgents(host.stateRoot);
          }
          const removed = yield* host.uninstall;
          if (Result.isFailure(removed)) {
            report(`this Mac's host could not be removed: ${removed.failure}`);
            return false;
          }
          report("this Mac's host was removed");
          yield* removeHostDevice(host.stateRoot);
          return true;
        }),
      ).pipe(
        Effect.catch((step) =>
          Effect.sync(() => {
            report(
              `this Mac's host: could not ${typeof step === "string" ? step : "be turned off"}`,
            );
            return false;
          }),
        ),
      );

    /** The account's host stopped and kept from starting at the next login, its files kept. */
    const keepStopped = Effect.gen(function* () {
      if (!host.runsHost) return;
      const record = yield* ownServiceRecord;
      if (Option.isNone(record) || record.value.refused === true) return;
      if (!(yield* accountOwns(record.value))) return;
      const stopped = yield* host.stop;
      if (Result.isFailure(stopped)) return yield* Effect.fail(`stop it: ${stopped.failure}`);
      report("this Mac's host was stopped");
    });

    /** What the app keeps the host at now, as the account and its experiments stand. */
    const keptNow: Effect.Effect<Kept> = Effect.gen(function* () {
      const userId = dependencies.accountId();
      if (userId === undefined || !account.capabilitiesActive() || !kernel.runMode.sendsNetwork) {
        return undefined;
      }
      return {
        userId,
        running: yield* dependencies.experimentOn(EXPERIMENT.BRING_YOUR_OWN_HOST),
        turns: MutableRef.get(turns),
      };
    });

    /** The host kept as asked, each step that failed tried again after `RETRY` until it lands. */
    const keep = (kept: Kept) =>
      kept === undefined
        ? Effect.void
        : (kept.running ? keepRunning : keepStopped).pipe(
            Effect.tapError((step) =>
              Effect.sync(() => report(`this Mac's host: could not ${step}, so it is tried again`)),
            ),
            Effect.retry(RETRY),
            Effect.catchDefect(() =>
              Effect.sync(() => report("this Mac's host could not be kept as asked")),
            ),
          );

    // Note that a change interrupts the keep under way, but for an enroll begun, which runs whole; This Mac is told on every pass.
    const lifetime = Effect.forkScoped(
      Stream.fromEffectSchedule(Effect.andThen(tellThisMac, keptNow), Schedule.spaced(IDLE)).pipe(
        Stream.changesWith(sameKept),
        Stream.switchMap((kept) => Stream.fromEffectDrain(keep(kept))),
        Stream.runDrain,
        Effect.provideContext(services),
      ),
    );

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.THIS_MAC_HOST> = {
      /** Run agents on this Mac turned on or off; done, or that it could not be, its windows told where it now stands. */
      [GATEWAY_METHOD.HOSTS_THIS_MAC_SET]: (params) =>
        Effect.gen(function* () {
          const { on, deleteFolders } = yield* readParams(
            thisMacHostSetParamsSchema,
            params,
            "a set says whether This Mac is on",
          );
          const done = yield* on ? turnedOn : turnedOff(deleteFolders ?? true);
          yield* tellThisMac;
          return carried(done ? DONE : UNDONE);
        }).pipe(Effect.provideContext(services)),
    };
    return { methods, lifetime: Effect.asVoid(lifetime) } satisfies Composer;
  });
}
