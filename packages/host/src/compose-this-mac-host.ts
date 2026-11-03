import { type HostedDeviceAgentClient, OWN_ENROLL_OUTCOME } from "@repo/features";
import { HOST_RELEASE } from "@repo/features/host-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { carried, GATEWAY_METHOD } from "@repo/gateway";
import { EXPERIMENT, type Experiment } from "@repo/settings";
import { Duration, Effect, Option, type Path, Result, Schedule, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { ThisMacHostRead } from "./contract/this-mac-host.js";
import { Reporter, ThisMacHost } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import { type HostDevice, readHostDevice, writeHostDevice } from "./host-device-record.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-this-mac-host.ts -- This Mac's host, the account install the install command puts on a Mac, kept running while the account has Bring your own host on and stopped while it has it off.
 *
 * There is one such install on a Mac, under the member's own home
 * (`ThisMacHost`'s `stateRoot`, `~/.local/state/luke-host`), so every build
 * of the app, released, Test, development, and each named instance, reads
 * and controls the same host. Where it stands is read again every `IDLE`,
 * and acted on only when it changed: at launch, at sign-in, and when Bring
 * your own host is turned on or off. While no account is signed in, nothing
 * on this Mac is installed, started, or stopped.
 *
 * With Bring your own host on, a Mac with no host of the account standing,
 * no record or one the service refused, is enrolled on the member's own
 * sign-in (`enrollOwn`), under the record's device id where it has one, so
 * a removed host comes back as itself, and under an id minted here where it
 * has none; its record is written where the install's host reads it; and
 * the install script the service serves is run, which installs or upgrades
 * the release, loads its LaunchAgent, and starts the host, whose `connect`
 * answers at once as connected. A host of the account standing is left as
 * it is, but started where launchd no longer holds it, the script run again
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

/** What the app keeps This Mac's host at for the account signed in; none where it keeps it at nothing, and leaves it as it stands. */
type Kept = { readonly userId: string; readonly running: boolean } | undefined;

const sameKept = (one: Kept, other: Kept) =>
  one?.userId === other?.userId && one?.running === other?.running;

export interface ThisMacHostDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "createId"> & {
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

    /** The account's host running: enrolled where none of it stands, and the script run where launchd holds none. */
    const keepRunning = Effect.gen(function* () {
      if (HOST_RELEASE === undefined || !host.runsHost) return;
      const record = yield* readHostDevice(host.stateRoot);
      if (Option.isSome(record) && !ownService(record.value)) return;
      if (Option.isNone(record) || record.value.refused === true) {
        const deviceId = Option.map(record, (kept) => kept.deviceId);
        if (!(yield* enrolled(deviceId, HOST_RELEASE.VERSION))) return;
      } else if (!(yield* accountOwns(record.value)) || (yield* host.loaded)) {
        return;
      }
      yield* installed;
    });

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
      return { userId, running: yield* dependencies.experimentOn(EXPERIMENT.BRING_YOUR_OWN_HOST) };
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

    // Note that a change interrupts the keep under way, but for an enroll begun, which runs whole.
    const lifetime = Effect.forkScoped(
      Stream.fromEffectSchedule(keptNow, Schedule.spaced(IDLE)).pipe(
        Stream.changesWith(sameKept),
        Stream.switchMap((kept) => Stream.fromEffectDrain(keep(kept))),
        Stream.runDrain,
        Effect.provideContext(services),
      ),
    );

    // Note that which machine this is never changes, so it is read once, at the panel's first ask.
    const machineId = yield* Effect.cached(
      Effect.map(host.machine, (machine) => machine.machineId),
    );

    /** This Mac as the panel reads it: which machine it is, and the device its record names, where it was enrolled with this app's service. */
    const read = Effect.map(
      Effect.all([ownServiceRecord, machineId]),
      ([record, id]): ThisMacHostRead => ({
        ...(Option.isSome(record) ? { deviceId: record.value.deviceId } : undefined),
        ...(id === undefined ? undefined : { machineId: id }),
      }),
    );

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.LOCAL_AGENTS> = {
      [GATEWAY_METHOD.THIS_MAC_HOST_READ]: () =>
        Effect.map(Effect.provideContext(read, services), carried),
    };
    return { methods, lifetime: Effect.asVoid(lifetime) } satisfies Composer;
  });
}
