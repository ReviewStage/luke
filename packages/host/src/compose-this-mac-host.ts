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

const IDLE = Duration.seconds(5);

const RETRY_AFTER = {
  FIRST: Duration.seconds(10),
  LONGEST: Duration.hours(1),
} as const;

const RETRY = Schedule.exponential(RETRY_AFTER.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, RETRY_AFTER.LONGEST)),
  ),
);

type Kept =
  | { readonly userId: string; readonly running: boolean; readonly turns: number }
  | undefined;

const sameKept = (one: Kept, other: Kept) =>
  one?.userId === other?.userId && one?.running === other?.running && one?.turns === other?.turns;

const sameThisMac = (one: AppThisMacHost, other: AppThisMacHost) =>
  one.deviceId === other.deviceId &&
  one.machineId === other.machineId &&
  one.enrolled === other.enrolled &&
  one.agentFolders === other.agentFolders;

const DONE = { done: true } as const;
const UNDONE = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

export interface ThisMacHostDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "createId" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  accountId: () => string | undefined;
  experimentOn: (experiment: Experiment) => Effect.Effect<boolean>;
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

    const ownService = (record: HostDevice) =>
      URL.canParse(record.serviceOrigin) && new URL(record.serviceOrigin).origin === serviceOrigin;

    const ownServiceRecord = Effect.map(readHostDevice(host.stateRoot), Option.filter(ownService));

    const machineId = yield* Effect.cached(
      Effect.map(host.machine, (machine) => machine.machineId),
    );

    const read = Effect.map(
      Effect.all([ownServiceRecord, machineId, ownedAgents(host.stateRoot)]),
      ([record, id, folders]): AppThisMacHost => ({
        ...(Option.isSome(record) ? { deviceId: record.value.deviceId } : undefined),
        ...(id === undefined ? undefined : { machineId: id }),
        enrolled: Option.isSome(record) && record.value.refused !== true,
        agentFolders: folders.length,
      }),
    );

    let told: { readonly userId: string | undefined; readonly thisMac: AppThisMacHost } | undefined;

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

    const accountOwns = (record: HostDevice) =>
      Effect.flatMap(dependencies.hostListed(record.deviceId), (listed) =>
        Option.isSome(listed)
          ? Effect.succeed(listed.value)
          : Effect.fail("read the account's hosts"),
      );

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

    const oneAtATime = (yield* Semaphore.make(1)).withPermits(1);

    const keepRunning = oneAtATime(
      Effect.gen(function* () {
        if (HOST_RELEASE === undefined || !host.runsHost) return;
        const record = yield* ownServiceRecord;
        if (Option.isNone(record) || record.value.refused === true) return;
        if (!(yield* accountOwns(record.value)) || (yield* host.loaded)) return;
        yield* installed;
      }),
    );

    const turns = MutableRef.make(0);

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

    const turnedOff = (deleteFolders: boolean) =>
      oneAtATime(
        Effect.gen(function* () {
          if (!host.runsHost) return false;
          const device = yield* readHostDevice(host.stateRoot);
          if (Option.isSome(device) && !ownService(device.value)) return false;
          const record = Option.filter(device, (kept) => kept.refused !== true);
          if (Option.isSome(record) && !(yield* accountOwns(record.value))) return false;
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

    const keepStopped = Effect.gen(function* () {
      if (!host.runsHost) return;
      const record = yield* ownServiceRecord;
      if (Option.isNone(record) || record.value.refused === true) return;
      if (!(yield* accountOwns(record.value))) return;
      const stopped = yield* host.stop;
      if (Result.isFailure(stopped)) return yield* Effect.fail(`stop it: ${stopped.failure}`);
      report("this Mac's host was stopped");
    });

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

    const lifetime = Effect.forkScoped(
      Stream.fromEffectSchedule(Effect.andThen(tellThisMac, keptNow), Schedule.spaced(IDLE)).pipe(
        Stream.changesWith(sameKept),
        Stream.switchMap((kept) => Stream.fromEffectDrain(keep(kept))),
        Stream.runDrain,
        Effect.provideContext(services),
      ),
    );

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.THIS_MAC_HOST> = {
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
