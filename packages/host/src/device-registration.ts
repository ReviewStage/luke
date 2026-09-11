import {
  type ChangesAnswer,
  type ChangesRequest,
  DEVICE_PLATFORM,
  type DepartingCredential,
  type DeviceForgetAnswer,
  type DeviceForgetRequest,
  type DeviceRegisterAnswer,
  type DeviceRegisterRequest,
  isDeviceWireId,
} from "@sidecar/hosted";
import { text, type WireRecord } from "@sidecar/wire";
import { Duration, Effect, Exit, Runtime, Schedule, Scope } from "effect";
import { DEVICE_POLL_INTERVAL_MS, type DevicePresenceReport } from "./device-presence.js";
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

/** The three calls the registration makes, as the hosted clients answer them. */
export interface DeviceRegistrationClient {
  register: (request: DeviceRegisterRequest) => Promise<DeviceRegisterAnswer | undefined>;
  /** The change-signal poll, which is also the row's heartbeat and carries its presence. */
  poll: (request: ChangesRequest) => Promise<ChangesAnswer | undefined>;
  forget: (
    request: DeviceForgetRequest,
    departing?: DepartingCredential,
  ) => Promise<DeviceForgetAnswer | undefined>;
}

export interface DeviceRegistrationOptions {
  client: DeviceRegistrationClient;
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

/**
 * This Mac's device row, kept standing while an account is signed in. `start`
 * registers the installation, polls once, and arms the poll; each poll moves
 * the row's last-seen instant and restates both of its instants — presence
 * and the meeting hold — as they stand at that moment, `null` where neither
 * holds, so a registration that cleared them is never followed by a stale
 * hold re-asserted from memory. A registration clears both on the service,
 * so every registration that lands is followed by a poll at once rather than
 * a minute of the row reading absent. A poll answered unseen re-registers,
 * as does one after a registration that never landed. A beat that fails is
 * reported and the cadence keeps its own beat all the same: the loop never
 * ends on an error, since nothing else would restart it. `stop` closes the
 * scope the cadence was forked into, and at a
 * sign-out also asks the service to forget the row, on the token of the
 * account that is leaving. Every answer is checked against the generation
 * that asked, so a call still out when the account changed installs nothing.
 * What the poll answers of the resources' heads is not read here: the reads
 * behind them are another concern's.
 */
export class DeviceRegistration {
  readonly #options: DeviceRegistrationOptions;
  readonly #intervalMs: number;
  readonly #runtime: Runtime.Runtime<never>;
  #generation = 0;
  /** The scope the cadence's fiber is forked into, held for as long as a registration stands. */
  #scope: Scope.CloseableScope | undefined;
  /**
   * The call under way, if any. A start waits for it before registering, so
   * a registration already on the wire at sign-out lands before the next
   * account's rather than after it, where it would move the row back. A stop
   * never waits for it: the work may be waiting on a token refresh that is
   * itself signing out.
   */
  #inFlight: Promise<void> = Promise.resolve();

  constructor(options: DeviceRegistrationOptions) {
    this.#options = options;
    this.#intervalMs = options.pollIntervalMs ?? DEVICE_POLL_INTERVAL_MS;
    this.#runtime = options.runtime ?? Runtime.defaultRuntime;
  }

  /** Whether a registration stands: started, and not yet stopped. */
  get standing(): boolean {
    return this.#scope !== undefined;
  }

  /** The row's id as the service last answered it, or nothing before a registration lands. */
  deviceId(): string | undefined {
    return this.#options.state.read()?.deviceId;
  }

  async start(): Promise<void> {
    if (this.#scope !== undefined) return;
    const scope = Runtime.runSync(this.#runtime)(Scope.make());
    this.#scope = scope;
    const generation = ++this.#generation;
    await this.#settle(() => this.#beat(generation));
    this.#arm(scope, generation);
  }

  async stop(options: { forget: DepartingCredential | false }): Promise<void> {
    this.#generation += 1;
    const scope = this.#scope;
    this.#scope = undefined;
    // Closing is not awaited, for the same reason cancelling a timer never
    // was: what it has to guarantee is that no further beat starts, never
    // that the fiber has already ended.
    if (scope !== undefined) Runtime.runFork(this.#runtime)(Scope.close(scope, Exit.void));
    if (options.forget === false) return;
    const deviceId = this.#options.state.read()?.deviceId;
    if (deviceId === undefined) return;
    // The row is let go of on the state before the service answers: the
    // account is leaving whether or not the service heard, and a row the
    // service still holds is re-keyed by the next sign-in's registration.
    this.#options.state.update((current) => ({
      installationId: current?.installationId ?? this.#installationId(),
    }));
    const forgetting = this.#options.client
      .forget({ deviceId }, options.forget)
      .then(() => undefined);
    const standing = this.#inFlight;
    this.#inFlight = Promise.all([standing, forgetting]).then(() => undefined);
    await forgetting;
  }

  /** Runs `work` once the call under way has settled, and holds the slot until it has, however it ended. */
  #settle(work: () => Promise<void>): Promise<void> {
    const next = this.#inFlight.then(work);
    this.#inFlight = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  #installationId(): string {
    const current = this.#options.state.read();
    if (current) return current.installationId;
    return this.#options.state.update(() => ({
      installationId: this.#options.mintInstallationId().toLowerCase(),
    })).installationId;
  }

  /** Registers the installation; answers the row's id where the registration landed for this generation. */
  async #register(generation: number): Promise<string | undefined> {
    const installationId = this.#installationId();
    const answer = await this.#options.client.register({
      platform: DEVICE_PLATFORM.MACOS,
      installationId,
    });
    if (generation !== this.#generation || answer === undefined) return undefined;
    this.#options.state.update((current) => ({
      installationId: current?.installationId ?? installationId,
      deviceId: answer.deviceId,
    }));
    return answer.deviceId;
  }

  /** One poll carrying the presence read now; answers whether the service still holds the row, or nothing for no answer. */
  async #poll(generation: number, deviceId: string): Promise<boolean | undefined> {
    const presence = await this.#options.presence();
    if (generation !== this.#generation) return undefined;
    // A quiet instant not yet known is left off the request: an absent field leaves the row's instant, where a sent value would claim to know it.
    const answer = await this.#options.client.poll({
      deviceId,
      activeUntil: presence.activeUntil,
      ...(presence.quietUntil !== undefined ? { quietUntil: presence.quietUntil } : undefined),
    });
    return generation === this.#generation ? answer?.seen : undefined;
  }

  /** Registers and, where the registration landed, polls at once so the row never reads absent for want of a report. */
  async #registerAndPoll(generation: number): Promise<void> {
    const deviceId = await this.#register(generation);
    if (deviceId !== undefined) await this.#poll(generation, deviceId);
  }

  /**
   * The beats after the one `start` awaited, as a fiber in the scope that
   * registration stands in, so the scope closing is what ends the cadence.
   * `Effect.schedule` and not `Effect.repeat`: the cadence's first beat is one
   * interval on from the start's own, where a repeat would beat again at once.
   * A stop that landed while the first beat was still out has taken the scope
   * already, and arms nothing over it.
   */
  #arm(scope: Scope.CloseableScope, generation: number): void {
    if (this.#scope !== scope) return;
    const pass = Effect.promise(() => this.#settle(() => this.#beat(generation)));
    Runtime.runSync(this.#runtime)(
      Effect.provideService(
        Effect.forkScoped(
          Effect.schedule(pass, Schedule.spaced(Duration.millis(this.#intervalMs))),
        ),
        Scope.Scope,
        scope,
      ),
    );
  }

  async #beat(generation: number): Promise<void> {
    try {
      const deviceId = this.#options.state.read()?.deviceId;
      if (deviceId === undefined) {
        await this.#registerAndPoll(generation);
      } else if ((await this.#poll(generation, deviceId)) === false) {
        await this.#registerAndPoll(generation);
      }
    } catch (error) {
      this.#options.report?.(
        `The device poll failed and will be tried again: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
