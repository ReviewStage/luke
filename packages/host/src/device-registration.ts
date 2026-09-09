import {
  DEVICE_PLATFORM,
  type DepartingCredential,
  type DeviceForgetAnswer,
  type DeviceForgetRequest,
  type DeviceHeartbeatAnswer,
  type DeviceHeartbeatRequest,
  type DeviceRegisterAnswer,
  type DeviceRegisterRequest,
  isDeviceWireId,
} from "@sidecar/hosted";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { text, type WireRecord } from "@sidecar/wire";
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

/**
 * How often a signed-in Mac moves its last-seen instant. Presence — the
 * instant input was last seen and the screen unlocked — is not reported yet,
 * so the heartbeat carries nothing but the row's id; a few minutes keeps the
 * row warm without a request per screen glance.
 */
export const DEVICE_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

/** The three calls the registration makes, as the hosted client answers them. */
export interface DeviceRegistrationClient {
  register: (request: DeviceRegisterRequest) => Promise<DeviceRegisterAnswer | undefined>;
  heartbeat: (request: DeviceHeartbeatRequest) => Promise<DeviceHeartbeatAnswer | undefined>;
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
  schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel: (timer: ScheduledTimer) => void;
  heartbeatIntervalMs?: number;
}

/**
 * This Mac's device row, kept standing while an account is signed in. `start`
 * registers the installation and arms the heartbeat; each beat moves the
 * row's last-seen instant, and re-registers when the service no longer holds
 * the row or a registration never landed. `stop` disarms the beat, and at a
 * sign-out also asks the service to forget the row, on the token of the
 * account that is leaving. Every answer is checked against the generation
 * that asked, so a call still out when the account changed installs nothing.
 */
export class DeviceRegistration {
  readonly #options: DeviceRegistrationOptions;
  readonly #intervalMs: number;
  #generation = 0;
  #timer: ScheduledTimer | undefined;
  #standing = false;
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
    this.#intervalMs = options.heartbeatIntervalMs ?? DEVICE_HEARTBEAT_INTERVAL_MS;
  }

  /** Whether a registration stands: started, and not yet stopped. */
  get standing(): boolean {
    return this.#standing;
  }

  /** The row's id as the service last answered it, or nothing before a registration lands. */
  deviceId(): string | undefined {
    return this.#options.state.read()?.deviceId;
  }

  async start(): Promise<void> {
    if (this.#standing) return;
    this.#standing = true;
    const generation = ++this.#generation;
    await this.#settle(() => this.#register(generation));
    this.#arm(generation);
  }

  async stop(options: { forget: DepartingCredential | false }): Promise<void> {
    this.#standing = false;
    this.#generation += 1;
    if (this.#timer !== undefined) {
      this.#options.cancel(this.#timer);
      this.#timer = undefined;
    }
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

  /** Runs `work` once the call under way has settled, and holds the slot until it has. */
  #settle(work: () => Promise<void>): Promise<void> {
    const next = this.#inFlight.then(work);
    this.#inFlight = next;
    return next;
  }

  #installationId(): string {
    const current = this.#options.state.read();
    if (current) return current.installationId;
    return this.#options.state.update(() => ({
      installationId: this.#options.mintInstallationId().toLowerCase(),
    })).installationId;
  }

  async #register(generation: number): Promise<void> {
    const installationId = this.#installationId();
    const answer = await this.#options.client.register({
      platform: DEVICE_PLATFORM.MACOS,
      installationId,
    });
    if (generation !== this.#generation || answer === undefined) return;
    this.#options.state.update((current) => ({
      installationId: current?.installationId ?? installationId,
      deviceId: answer.deviceId,
    }));
  }

  #arm(generation: number): void {
    if (generation !== this.#generation) return;
    this.#timer = this.#options.schedule(() => {
      this.#timer = undefined;
      void this.#settle(() => this.#beat(generation));
    }, this.#intervalMs);
  }

  async #beat(generation: number): Promise<void> {
    const deviceId = this.#options.state.read()?.deviceId;
    if (deviceId === undefined) {
      await this.#register(generation);
    } else {
      const answer = await this.#options.client.heartbeat({ deviceId });
      if (generation === this.#generation && answer?.seen === false) {
        await this.#register(generation);
      }
    }
    this.#arm(generation);
  }
}
