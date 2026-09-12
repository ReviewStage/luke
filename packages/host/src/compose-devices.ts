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
import { text, type WireRecord } from "@sidecar/wire";
import { Duration, Effect, Fiber, Schedule, type Scope } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { Composer } from "./composer.js";
import {
  activeUntilFrom,
  DEVICE_POLL_INTERVAL_MS,
  type DevicePresenceReport,
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
  register: (request: DeviceRegisterRequest) => Promise<DeviceRegisterAnswer | undefined>;
  /** The change-signal poll, which is also the row's heartbeat and carries its presence. */
  poll: (request: ChangesRequest) => Promise<ChangesAnswer | undefined>;
  forget: (
    request: DeviceForgetRequest,
    departing?: DepartingCredential,
  ) => Promise<DeviceForgetAnswer | undefined>;
}

export interface DeviceCadenceOptions {
  client: DeviceCadenceClient;
  state: JsonStateFile<DeviceState>;
  /** Mints the installation id once, on the first registration this state root ever makes. */
  mintInstallationId: () => string;
  /** What this machine reports of itself on each poll, read at the poll and never held between them. */
  presence: () => Promise<DevicePresenceReport>;
  pollIntervalMs?: number;
  /** Hears a beat that failed; the cadence keeps its own beat either way. */
  report?: (message: string) => void;
}

export interface DeviceCadence {
  /** Whether a registration stands: started, and not yet stopped. */
  readonly standing: boolean;
  /** The row's id as the service last answered it, or nothing before a registration lands. */
  deviceId: () => string | undefined;
  /** Registers the installation, polls once, and arms the poll; idempotent while a registration stands. */
  readonly start: Effect.Effect<void>;
  /** Disarms the poll and, at a sign-out, asks the service to forget the row on the departing token. */
  stop: (options: { forget: DepartingCredential | false }) => Effect.Effect<void>;
}

/**
 * This Mac's device row on the service, kept standing while an account is
 * signed in. `start` registers the installation, polls once, and arms the
 * poll; each poll moves the row's last-seen instant and restates both of its
 * instants — presence and the meeting hold — as they stand at that moment,
 * `null` where neither holds, so a registration that cleared them is never
 * followed by a stale hold re-asserted from memory. A registration clears
 * both on the service, so every registration that lands is followed by a
 * poll at once rather than a minute of the row reading absent. A poll
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
export const deviceCadence = (
  options: DeviceCadenceOptions,
): Effect.Effect<DeviceCadence, never, Scope.Scope> =>
  Effect.gen(function* () {
    const intervalMs = options.pollIntervalMs ?? DEVICE_POLL_INTERVAL_MS;
    let generation = 0;
    let standing = false;
    /**
     * The call under way, if any. A start waits for it before registering, so a
     * registration already on the wire at sign-out lands before the next
     * account's rather than after it, where it would move the row back. A stop
     * never waits for it: the work may be waiting on a token refresh that is
     * itself signing out.
     */
    let inFlight: Promise<void> = Promise.resolve();

    /** Runs `work` once the call under way has settled, and holds the slot until it has, however it ended. */
    function settle(work: () => Promise<void>): Promise<void> {
      const next = inFlight.then(work);
      inFlight = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    }

    function installationId(): string {
      const current = options.state.read();
      if (current) return current.installationId;
      return options.state.update(() => ({
        installationId: options.mintInstallationId().toLowerCase(),
      })).installationId;
    }

    /** Registers the installation; answers the row's id where the registration landed for this generation. */
    async function register(gen: number): Promise<string | undefined> {
      const id = installationId();
      const answer = await options.client.register({
        platform: DEVICE_PLATFORM.MACOS,
        installationId: id,
      });
      if (gen !== generation || answer === undefined) return undefined;
      options.state.update((current) => ({
        installationId: current?.installationId ?? id,
        deviceId: answer.deviceId,
      }));
      return answer.deviceId;
    }

    /** One poll carrying the presence read now; answers whether the service still holds the row, or nothing for no answer. */
    async function poll(gen: number, deviceId: string): Promise<boolean | undefined> {
      const presence = await options.presence();
      if (gen !== generation) return undefined;
      // A quiet instant not yet known is left off the request: an absent field leaves the row's instant, where a sent value would claim to know it.
      const answer = await options.client.poll({
        deviceId,
        activeUntil: presence.activeUntil,
        ...(presence.quietUntil !== undefined ? { quietUntil: presence.quietUntil } : undefined),
      });
      return gen === generation ? answer?.seen : undefined;
    }

    /** Registers and, where the registration landed, polls at once so the row never reads absent for want of a report. */
    async function registerAndPoll(gen: number): Promise<void> {
      const deviceId = await register(gen);
      if (deviceId !== undefined) await poll(gen, deviceId);
    }

    async function beat(gen: number): Promise<void> {
      try {
        const deviceId = options.state.read()?.deviceId;
        if (deviceId === undefined) {
          await registerAndPoll(gen);
        } else if ((await poll(gen, deviceId)) === false) {
          await registerAndPoll(gen);
        }
      } catch (error) {
        options.report?.(
          `The device poll failed and will be tried again: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    /**
     * What an arming stands up: the registration's own beat and the cadence
     * after it, as one fiber the arming's scope interrupts. `Effect.schedule`
     * and not `Effect.repeat`: the cadence's first beat is one interval on
     * from the registration's, where a repeat would beat again at once. The
     * interruption is forked rather than awaited, for the same reason
     * cancelling a timer never was: what a disarm has to guarantee is that no
     * further beat starts, never that a call already on the wire has answered,
     * since it may be waiting on a token refresh that is itself signing out.
     * The generation is bumped when the scope closes, so a call still out when
     * the account changed installs nothing.
     */
    const armed = Effect.gen(function* () {
      const gen = ++generation;
      standing = true;
      const pass = Effect.suspend(() =>
        gen === generation ? Effect.promise(() => settle(() => beat(gen))) : Effect.void,
      );
      yield* Effect.acquireRelease(
        Effect.forkDaemon(
          Effect.zipRight(
            pass,
            Effect.schedule(pass, Schedule.spaced(Duration.millis(intervalMs))),
          ),
        ),
        Fiber.interruptFork,
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
          const forgetting = options.client
            .forget({ deviceId }, stopOptions.forget)
            .then(() => undefined);
          const standingCall = inFlight;
          inFlight = Promise.all([standingCall, forgetting]).then(() => undefined);
          yield* Effect.promise(() => forgetting);
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
}

export interface DevicesDependencies {
  account: AccountComposer;
  calendars: CalendarsComposer;
}

/**
 * This Mac's device row on the service: one row per installation, registered
 * at sign-in, kept warm by the change-signal poll, and forgotten at sign-out.
 * Each poll carries the two facts this machine reports of itself — the
 * instant its presence holds until, from the idle time and lock state the
 * client reads off the machine, and the instant the calendar's meeting hold
 * ends — and decides nothing from either. The installation id lives in the
 * host's own state root beside the onboarding record, and a fixture or
 * evidence run, which sends nothing, registers nothing.
 */
export const composeDevices = (
  dependencies: DevicesDependencies,
): Effect.Effect<DevicesComposer, never, HostKernelTag | MachinePresenceReader | Scope.Scope> =>
  Effect.gen(function* () {
    const { account, calendars } = dependencies;
    const kernel: HostKernel = yield* HostKernelTag;
    const machinePresence = yield* MachinePresenceReader;
    const { runMode, report, now } = kernel;

    const credential = { serviceBaseUrl: kernel.hostedServiceBaseUrl, ...account.token };
    const devicesClient = new HostedDeviceClient(credential);
    const changesClient = new HostedChangesClient(credential);

    const cadence = yield* deviceCadence({
      client: {
        register: (request) => devicesClient.register(request),
        poll: (request) => changesClient.poll(request),
        forget: (request, departing) => devicesClient.forget(request, departing),
      },
      state: deviceStateFile(() => kernel.stateRoot, report),
      mintInstallationId: kernel.createId,
      presence: async () => {
        const at = now();
        return {
          activeUntil: activeUntilFrom(machinePresence.read?.(), at),
          quietUntil: await calendars.meetingQuietUntil(at),
        };
      },
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
      // A quit is not a sign-out: the poll stops and the row stands for the next launch.
      lifetime: Effect.addFinalizer(() => release(undefined)),
    };
  });
