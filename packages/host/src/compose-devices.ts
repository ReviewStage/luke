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
import { text, type WireRecord } from "@sidecar/wire";
import { Duration, Effect, Exit, Runtime, Schedule, Scope } from "effect";
import type { AccountComposer } from "./compose-account.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { Composer } from "./composer.js";
import {
  activeUntilFrom,
  DEVICE_POLL_INTERVAL_MS,
  type DevicePresenceReport,
} from "./device-presence.js";
import { HostKernelTag } from "./effect/kernel.js";
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
  /** The runtime the cadence is forked on, for a caller (a test today) that holds its own. */
  runtime?: Runtime.Runtime<never>;
}

export interface DeviceCadence {
  /** Whether a registration stands: started, and not yet stopped. */
  readonly standing: boolean;
  /** The row's id as the service last answered it, or nothing before a registration lands. */
  deviceId: () => string | undefined;
  start: () => Promise<void>;
  stop: (options: { forget: DepartingCredential | false }) => Promise<void>;
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
 * restart it. `stop` closes the scope the cadence was forked into, and at a
 * sign-out also asks the service to forget the row, on the token of the
 * account that is leaving. Every answer is checked against the generation
 * that asked, so a call still out when the account changed installs
 * nothing. What the poll answers of the resources' heads is not read here:
 * the reads behind them are another concern's.
 */
export function deviceCadence(options: DeviceCadenceOptions): DeviceCadence {
  const intervalMs = options.pollIntervalMs ?? DEVICE_POLL_INTERVAL_MS;
  const runtime = options.runtime ?? Runtime.defaultRuntime;
  let generation = 0;
  /** The scope the cadence's fiber is forked into, held for as long as a registration stands. */
  let scope: Scope.CloseableScope | undefined;
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
   * The beats after the one `start` awaited, as a fiber in the scope that
   * registration stands in, so the scope closing is what ends the cadence.
   * `Effect.schedule` and not `Effect.repeat`: the cadence's first beat is one
   * interval on from the start's own, where a repeat would beat again at once.
   * A stop that landed while the first beat was still out has taken the scope
   * already, and arms nothing over it.
   */
  function arm(target: Scope.CloseableScope, gen: number): void {
    if (scope !== target) return;
    const pass = Effect.promise(() => settle(() => beat(gen)));
    Runtime.runSync(runtime)(
      Effect.provideService(
        Effect.forkScoped(Effect.schedule(pass, Schedule.spaced(Duration.millis(intervalMs)))),
        Scope.Scope,
        target,
      ),
    );
  }

  return {
    get standing() {
      return scope !== undefined;
    },
    deviceId: () => options.state.read()?.deviceId,
    async start(): Promise<void> {
      if (scope !== undefined) return;
      const next = Runtime.runSync(runtime)(Scope.make());
      scope = next;
      const gen = ++generation;
      await settle(() => beat(gen));
      arm(next, gen);
    },
    async stop(stopOptions: { forget: DepartingCredential | false }): Promise<void> {
      generation += 1;
      const closing = scope;
      scope = undefined;
      // Closing is not awaited, for the same reason cancelling a timer never
      // was: what it has to guarantee is that no further beat starts, never
      // that the fiber has already ended.
      if (closing !== undefined) Runtime.runFork(runtime)(Scope.close(closing, Exit.void));
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
      const standing = inFlight;
      inFlight = Promise.all([standing, forgetting]).then(() => undefined);
      await forgetting;
    },
  };
}

export interface DevicesComposer extends Composer {
  /**
   * Registers this installation with the service and arms the poll. A
   * no-op while the account gate is closed or the run sends nothing, and
   * idempotent while a registration stands.
   */
  register: () => Promise<void>;
  /**
   * Disarms the poll. Handed the departing account, it also asks the
   * service to forget the row, on that account's own token, before the
   * credential is cleared; handed nothing, the row stands for the next launch.
   */
  release: (departing: StoredAccount | undefined) => Promise<void>;
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
): Effect.Effect<DevicesComposer, never, HostKernelTag> =>
  Effect.gen(function* () {
    const { account, calendars } = dependencies;
    const kernel: HostKernel = yield* HostKernelTag;
    const runtime = yield* Effect.runtime<never>();
    const { runMode, report, now } = kernel;

    const credential = { serviceBaseUrl: kernel.hostedServiceBaseUrl, ...account.token };
    const devicesClient = new HostedDeviceClient(credential);
    const changesClient = new HostedChangesClient(credential);

    const cadence = deviceCadence({
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
          activeUntil: activeUntilFrom(kernel.options.machinePresence?.(), at),
          quietUntil: await calendars.meetingQuietUntil(at),
        };
      },
      report,
      runtime,
    });

    async function register(): Promise<void> {
      if (!runMode.sendsNetwork || !account.capabilitiesActive()) return;
      await cadence.start();
    }

    async function release(departing: StoredAccount | undefined): Promise<void> {
      await cadence.stop({
        forget:
          departing !== undefined && runMode.sendsNetwork
            ? { accessToken: departing.accessToken }
            : false,
      });
    }

    return {
      methods: {},
      register,
      release,
      deviceId: () => cadence.deviceId(),
      start: async () => undefined,
      // A quit is not a sign-out: the poll stops and the row stands for the next launch.
      stop: () => release(undefined),
    };
  });
