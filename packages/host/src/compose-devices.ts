import type { StoredAccount } from "@sidecar/credentials";
import {
  type ChangesAnswer,
  type ChangesRequest,
  DEVICE_PLATFORM,
  type DepartingCredential,
  type DeviceForgetAnswer,
  type DeviceForgetRequest,
  type DeviceRegisterAnswer,
  type DeviceRegisterRequest,
  HostedChangesClient,
  HostedDeviceClient,
  isDeviceWireId,
} from "@sidecar/hosted";
import { cadenceGate } from "@sidecar/runtime/effect";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { text, type WireRecord } from "@sidecar/wire";
import { Deferred, Duration, Effect, Exit, Fiber, Ref, Schedule, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import {
  activeUntilFrom,
  DEVICE_POLL_INTERVAL_MS,
  type DevicePresenceReport,
  reportedQuietUntil,
} from "./device-presence.js";
import { HostKernelTag } from "./effect/kernel.js";
import { MachinePresenceReader } from "./effect/seams.js";
import type { HostKernel } from "./host-kernel.js";
import { type JsonStateFile, jsonStateFile } from "./json-state-file.js";

/** The device record, in the app's own state directory. */
export const DEVICE_STATE_FILE = "device.json";

/**
 * What this installation keeps of its device row: the id it minted for itself
 * once, which keys the row on the service across accounts, and the id the
 * service answered for the row, which a heartbeat names. The installation id
 * outlives every sign-out on purpose: it is what lets a sign-in under another
 * account move the one row instead of leaving a second.
 */
export interface DeviceState {
  installationId: string;
  deviceId?: string;
}

/** Reads a stored record, or nothing for one without a well-formed installation id. */
export function deviceStateFrom(record: WireRecord): DeviceState | undefined {
  const installationId = text(record.installationId)?.toLowerCase();
  if (installationId === undefined || !isDeviceWireId(installationId)) return undefined;
  const deviceId = text(record.deviceId)?.toLowerCase();
  return {
    installationId,
    ...(deviceId !== undefined && isDeviceWireId(deviceId) ? { deviceId } : undefined),
  };
}

function deviceRecord(state: DeviceState): WireRecord {
  return {
    installationId: state.installationId,
    ...(state.deviceId !== undefined ? { deviceId: state.deviceId } : undefined),
  };
}

export function deviceStateFile(
  directory: () => string,
  report?: (message: string) => void,
): JsonStateFile<DeviceState> {
  return jsonStateFile<DeviceState>({
    directory,
    fileName: DEVICE_STATE_FILE,
    read: deviceStateFrom,
    write: deviceRecord,
    ...(report !== undefined ? { report } : undefined),
  });
}

/** The three calls the cadence makes, as the hosted clients answer them. */
export interface DeviceCadenceClient {
  register: (request: DeviceRegisterRequest) => Effect.Effect<DeviceRegisterAnswer | undefined>;
  /** The change-signal poll, which is also the row's heartbeat and carries its presence. */
  poll: (request: ChangesRequest) => Effect.Effect<ChangesAnswer | undefined>;
  forget: (
    request: DeviceForgetRequest,
    departing?: DepartingCredential,
  ) => Effect.Effect<DeviceForgetAnswer | undefined>;
}

interface DeviceCadenceOptions {
  client: DeviceCadenceClient;
  state: JsonStateFile<DeviceState>;
  /** Mints the installation id once, on the first registration this state root ever makes. */
  mintInstallationId: () => string;
  /** What this machine reports of itself on each poll, read at the poll and never held between them. */
  presence: Effect.Effect<DevicePresenceReport>;
  pollIntervalMs?: number;
  /** Hears a beat that failed; the cadence keeps its own beat either way. */
  report?: (message: string) => void;
}

interface DeviceCadence {
  /** Whether a registration stands: started, and not yet stopped. */
  readonly standing: boolean;
  /** The row's id as the service last answered it, or nothing before a registration lands. */
  deviceId: () => string | undefined;
  /** Registers the installation, polls once, and arms the poll; idempotent while a registration stands. */
  readonly start: Effect.Effect<void>;
  /** Disarms the poll and, at a sign-out, asks the service to forget the row on the departing token. */
  stop: (options: { forget: DepartingCredential | false }) => Effect.Effect<void>;
  /**
   * One beat now, outside the cadence, while a registration stands; nothing
   * otherwise, since a row not registered has nothing to restate. What a hold
   * that just moved owes the service is a report that does not wait for the
   * next scheduled beat: a pause released or an introduction completed would
   * otherwise leave the row quiet for up to a minute more.
   */
  readonly restate: Effect.Effect<void>;
}

/**
 * This Mac's device row on the service, kept standing while an account is
 * signed in. `start` registers the installation, polls once, and arms the
 * poll; each poll moves the row's last-seen instant and restates both of its
 * instants — presence and the quiet — as they stand at that moment, `null`
 * where neither holds, so a registration that cleared them is never
 * followed by a stale hold re-asserted from memory. `restate` is one such
 * beat between the scheduled ones, taken through the same in-flight slot so
 * it never overlaps a call already out. A registration clears both on the
 * service, so every registration that lands is followed by a poll at once
 * rather than a minute of the row reading absent. A poll
 * answered unseen re-registers, as does one after a registration that never
 * landed. A beat that fails is reported and the cadence keeps its own beat
 * all the same: the loop never ends on an error, since nothing else would
 * restart it. `stop` disarms the gate the cadence stands in — a disarm that
 * arrives while a start is still out waits for it and then undoes it — and at
 * a sign-out also asks the service to forget the row, on the token of the
 * account that is leaving. Every answer is checked against the generation
 * that asked, so a call still out when the account changed installs
 * nothing. What the poll answers of the resources' heads is not read here:
 * the reads behind them are another concern's.
 */
export const deviceCadence = /* @__PURE__ */ Effect.fn("deviceCadence")(function* (
  options: DeviceCadenceOptions,
): Effect.fn.Return<DeviceCadence, never, Scope.Scope> {
  const intervalMs = options.pollIntervalMs ?? DEVICE_POLL_INTERVAL_MS;
  let generation = 0;
  let standing = false;
  /**
   * The call under way, as the effect that waits for it to have settled. A
   * start waits for it before registering, so a registration already on the
   * wire at sign-out lands before the next account's rather than after it,
   * where it would move the row back. A stop never waits for it: the work
   * may be waiting on a token refresh that is itself signing out.
   */
  const inFlight = yield* Ref.make<Effect.Effect<void>>(Effect.void);

  /** Runs `work` once the call under way has settled, and holds the slot until it has, however it ended. */
  const settle = /* @__PURE__ */ Effect.fnUntraced(function* (
    work: Effect.Effect<void>,
  ): Effect.fn.Return<void> {
    const done = yield* Deferred.make<void>();
    const standingCall = yield* Ref.modify(inFlight, (current) => [current, Deferred.await(done)]);
    return yield* Effect.onExit(Effect.andThen(standingCall, work), (exit) =>
      // A wait the disarm interrupted hands the slot on to the call still
      // under way rather than opening it, so a registration on the wire
      // keeps its place in the order however many sign-outs arrive while
      // it is out; only a wait that reached its own work releases it.
      Exit.hasInterrupts(exit)
        ? Deferred.completeWith(done, standingCall)
        : Deferred.succeed(done, undefined),
    );
  });

  function installationId(): string {
    const current = options.state.read();
    if (current) return current.installationId;
    return options.state.update(() => ({
      installationId: options.mintInstallationId().toLowerCase(),
    })).installationId;
  }

  /** Registers the installation; answers the row's id where the registration landed for this generation. */
  const register = /* @__PURE__ */ Effect.fnUntraced(function* (
    gen: number,
  ): Effect.fn.Return<string | undefined> {
    const id = installationId();
    const answer = yield* options.client.register({
      platform: DEVICE_PLATFORM.MACOS,
      installationId: id,
    });
    if (gen !== generation || answer === undefined) return undefined;
    options.state.update((current) => ({
      installationId: current?.installationId ?? id,
      deviceId: answer.deviceId,
    }));
    return answer.deviceId;
  });

  /** One poll carrying the presence read now; answers whether the service still holds the row, or nothing for no answer. */
  const poll = /* @__PURE__ */ Effect.fnUntraced(function* (
    gen: number,
    deviceId: string,
  ): Effect.fn.Return<boolean | undefined> {
    const presence = yield* options.presence;
    if (gen !== generation) return undefined;
    // A quiet instant not yet known is left off the request: an absent field leaves the row's instant, where a sent value would claim to know it.
    const answer = yield* options.client.poll({
      deviceId,
      activeUntil: presence.activeUntil,
      ...(presence.quietUntil !== undefined ? { quietUntil: presence.quietUntil } : undefined),
    });
    return gen === generation ? answer?.seen : undefined;
  });

  /** Registers and, where the registration landed, polls at once so the row never reads absent for want of a report. */
  const registerAndPoll = /* @__PURE__ */ Effect.fnUntraced(function* (
    gen: number,
  ): Effect.fn.Return<void> {
    const deviceId = yield* register(gen);
    if (deviceId !== undefined) yield* poll(gen, deviceId);
  });

  /**
   * One beat. Every way it can fail is a defect here, since each of the
   * calls it makes answers an effect that cannot fail, so the report stands
   * where the caught throw used to and an interruption still passes through.
   */
  const beat = /* @__PURE__ */ Effect.fnUntraced(
    function* (gen: number): Effect.fn.Return<void> {
      const deviceId = options.state.read()?.deviceId;
      if (deviceId === undefined) {
        yield* registerAndPoll(gen);
      } else if ((yield* poll(gen, deviceId)) === false) {
        yield* registerAndPoll(gen);
      }
    },
    Effect.catchDefect((error) =>
      Effect.sync(() => {
        options.report?.(
          `The device poll failed and will be tried again: ${error instanceof Error ? error.message : String(error)}`,
        );
      }),
    ),
  );

  /**
   * One beat of the generation named, or nothing once that generation has
   * passed. The generation is read after the wait for the call already out,
   * not before it: a restate is detached, so no disarm interrupts its wait
   * the way it does the cadence fiber's, and a sign-out that lands while it
   * waits would otherwise be followed by a registration for an account that
   * has left.
   */
  const passOf = (gen: number): Effect.Effect<void> =>
    settle(
      Effect.suspend(() => (gen === generation ? Effect.uninterruptible(beat(gen)) : Effect.void)),
    );

  /**
   * What an arming stands up: the registration's own beat and the cadence
   * after it, as one fiber the arming's scope interrupts. `Effect.schedule`
   * and not `Effect.repeat`: the cadence's first beat is one interval on
   * from the registration's, where a repeat would beat again at once. The
   * beat itself is uninterruptible and the interruption forked rather than
   * awaited, for the same reason cancelling a timer never was: what a disarm
   * has to guarantee is that no further beat starts, never that a call
   * already on the wire has answered, since it may be waiting on a token
   * refresh that is itself signing out. The generation is bumped when the
   * scope closes, so a call still out when the account changed installs
   * nothing.
   */
  const armed = Effect.gen(function* () {
    const gen = ++generation;
    standing = true;
    const pass = passOf(gen);
    yield* Effect.acquireRelease(
      Effect.forkDetach(
        Effect.andThen(pass, Effect.schedule(pass, Schedule.spaced(Duration.millis(intervalMs)))),
      ),
      (fiber) => Effect.sync(() => fiber.interruptUnsafe()),
    );
    // Registered after the fork, so it runs before the interruption: a beat
    // the interruption has not reached yet reads the bumped generation and
    // sends nothing.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        generation += 1;
        standing = false;
      }),
    );
  });

  const gate = yield* cadenceGate(armed);

  return {
    get standing() {
      return standing;
    },
    deviceId: () => options.state.read()?.deviceId,
    start: gate.arm,
    // Reads the generation at the moment it runs: a restate offered after a
    // stop, or after a stop and the next start, beats for the registration
    // standing then or not at all.
    restate: Effect.suspend(() => (standing ? passOf(generation) : Effect.void)),
    stop: (stopOptions: { forget: DepartingCredential | false }) =>
      Effect.gen(function* () {
        yield* gate.disarm;
        if (stopOptions.forget === false) return;
        const deviceId = options.state.read()?.deviceId;
        if (deviceId === undefined) return;
        // The row is let go of on the state before the service answers: the
        // account is leaving whether or not the service heard, and a row the
        // service still holds is re-keyed by the next sign-in's registration.
        options.state.update((current) => ({
          installationId: current?.installationId ?? installationId(),
        }));
        const forgetting = yield* Effect.forkDetach(
          options.client.forget({ deviceId }, stopOptions.forget),
        );
        yield* Ref.update(inFlight, (standingCall) =>
          Effect.asVoid(
            Effect.all([standingCall, Fiber.await(forgetting)], { concurrency: "unbounded" }),
          ),
        );
        yield* Effect.asVoid(Fiber.join(forgetting));
      }),
  };
});

export interface DevicesComposer extends Composer {
  /**
   * Registers this installation with the service and arms the poll. A
   * no-op while the account gate is closed or the run sends nothing, and
   * idempotent while a registration stands.
   */
  readonly register: Effect.Effect<void>;
  /**
   * Disarms the poll. Handed the departing account, it also asks the
   * service to forget the row, on that account's own token, before the
   * credential is cleared; handed nothing, the row stands for the next launch.
   */
  release: (departing: StoredAccount | undefined) => Effect.Effect<void>;
  /** The row's id as the service last answered it, or nothing before a registration lands. */
  deviceId: () => string | undefined;
  /**
   * One heartbeat now, forked rather than awaited, so a hold that just moved
   * reaches the service without the caller waiting on the round trip; a
   * beat that fails is reported by the cadence as any beat is. Nothing while
   * no registration stands.
   */
  readonly reportPresence: Effect.Effect<void>;
}

interface DevicesDependencies {
  account: AccountComposer;
  calendars: CalendarsComposer;
  settings: SettingsComposer;
}

/**
 * This Mac's device row on the service: one row per installation, registered
 * at sign-in, kept warm by the change-signal poll, and forgotten at sign-out.
 * Each poll carries the two facts this machine reports of itself — the
 * instant its presence holds until, from the idle time and lock state the
 * client reads off the machine, and the instant its quiet ends: the
 * calendar's meeting hold, the announce-sessions pause, and the spoken
 * introduction still owed, folded to the one instant the heartbeat carries
 * (`reportedQuietUntil`) — and decides nothing from either. The service's
 * exchange is what speaks a briefing since E5-3, so a hold that stays on
 * this Mac holds nothing; the heartbeat is where each crosses. The
 * installation id lives in the host's own state root beside the onboarding
 * record, and a fixture or evidence run, which sends nothing, registers
 * nothing.
 */
export const composeDevices = /* @__PURE__ */ Effect.fn("composeDevices")(function* (
  dependencies: DevicesDependencies,
): Effect.fn.Return<DevicesComposer, never, HostKernelTag | MachinePresenceReader | Scope.Scope> {
  const { account, calendars, settings } = dependencies;
  const kernel: HostKernel = yield* HostKernelTag;
  const machinePresence = yield* MachinePresenceReader;
  const { runMode, report, now } = kernel;

  const credential = { serviceBaseUrl: kernel.hostedServiceBaseUrl, ...account.token };
  const devicesClient = new HostedDeviceClient(credential);
  const changesClient = new HostedChangesClient(credential);

  const cadence = yield* deviceCadence({
    // Every call of this row is the client's own effect, yielded by the
    // beat. `poll` carries no client of its own, so the ambient one is
    // provided to it here.
    client: {
      register: (request) => devicesClient.register(request),
      poll: (request) => Effect.provide(changesClient.poll(request), FetchHttpClient.layer),
      forget: (request, departing) => devicesClient.forget(request, departing),
    },
    state: deviceStateFile(() => kernel.stateRoot, report),
    mintInstallationId: kernel.createId,
    presence: Effect.gen(function* () {
      const at = now();
      const paused = !(yield* Effect.orDie(
        settings.store.get(APP_SETTING_SCHEMA.announceSessions.field),
      ));
      return {
        activeUntil: activeUntilFrom(machinePresence.read?.(), at),
        quietUntil: reportedQuietUntil(
          yield* calendars.meetingQuietUntil(at),
          { paused, introductionOwed: calendars.introductionOwed() },
          at,
        ),
      };
    }),
    report,
  });

  const register = Effect.suspend(() =>
    runMode.sendsNetwork && account.capabilitiesActive() ? cadence.start : Effect.void,
  );

  const release = (departing: StoredAccount | undefined): Effect.Effect<void> =>
    cadence.stop({
      forget:
        departing !== undefined && runMode.sendsNetwork
          ? { accessToken: departing.accessToken }
          : false,
    });

  return {
    methods: {},
    register,
    release,
    deviceId: () => cadence.deviceId(),
    reportPresence: Effect.asVoid(Effect.forkDetach(cadence.restate)),
    // A quit is not a sign-out: the poll stops and the row stands for the next launch.
    lifetime: Effect.addFinalizer(() => release(undefined)),
  };
});
