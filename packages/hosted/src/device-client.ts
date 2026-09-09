import {
  type CloudFetch,
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
  withoutTrailingSlash,
} from "@sidecar/wire";
import type { AccountToken } from "./account-token.js";
import {
  type DeviceForgetAnswer,
  type DeviceForgetRequest,
  type DeviceHeartbeatAnswer,
  type DeviceHeartbeatRequest,
  type DeviceRegisterAnswer,
  type DeviceRegisterRequest,
  deviceForgetAnswerSchema,
  deviceForgetRequestSchema,
  deviceHeartbeatAnswerSchema,
  deviceHeartbeatRequestSchema,
  deviceRegisterAnswerSchema,
  deviceRegisterRequestSchema,
} from "./device-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

const DEVICE_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;

export interface HostedDeviceClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/** The one path's three methods, as the service dispatches them. */
export const DEVICE_METHOD = {
  REGISTER: "POST",
  HEARTBEAT: "PUT",
  FORGET: "DELETE",
} as const;

export type DeviceMethod = (typeof DEVICE_METHOD)[keyof typeof DEVICE_METHOD];

interface DeviceRequest {
  method: DeviceMethod;
  body: WireRecord;
}

/** The token of an account on its way out, carried into the one call made on its behalf. */
export interface DepartingCredential {
  accessToken: string;
}

/**
 * Each request as the record that travels, field by field. Built twice per
 * call — once from the caller's request for the schema to read, and again
 * from what the schema admitted, so what is sent is the normalized value and
 * never a field the schema did not name.
 */
function registerRecord(request: DeviceRegisterRequest): WireRecord {
  return {
    platform: request.platform,
    installationId: request.installationId,
    ...(request.pushToken !== undefined ? { pushToken: request.pushToken } : undefined),
    ...(request.pushEnvironment !== undefined
      ? { pushEnvironment: request.pushEnvironment }
      : undefined),
  };
}

function heartbeatRecord(request: DeviceHeartbeatRequest): WireRecord {
  return {
    deviceId: request.deviceId,
    ...(request.activeUntil !== undefined ? { activeUntil: request.activeUntil } : undefined),
    ...(request.pushToken !== undefined ? { pushToken: request.pushToken } : undefined),
    ...(request.pushEnvironment !== undefined
      ? { pushEnvironment: request.pushEnvironment }
      : undefined),
  };
}

function forgetRecord(request: DeviceForgetRequest): WireRecord {
  return { deviceId: request.deviceId };
}

/**
 * The desktop's side of the device record: register this installation at
 * sign-in, move its last-seen instant on a timer, and forget it at sign-out.
 * The shape follows the hosted vault client — token read fresh per ask, a 401
 * refreshed and retried once, every answer validated by the shared wire
 * contract — and a failure resolves to nothing, because no row press waits on
 * it: a registration that did not land is tried again by the next heartbeat.
 * A request the service would refuse by shape is refused here without
 * traveling at all.
 */
export class HostedDeviceClient {
  readonly #baseUrl: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: CloudFetch;
  readonly #requestTimeoutMs: number;

  constructor(options: HostedDeviceClientOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#baseUrl = withoutTrailingSlash(baseUrl);
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DEVICE_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  register(request: DeviceRegisterRequest): Promise<DeviceRegisterAnswer | undefined> {
    const admitted = deviceRegisterRequestSchema.parse(registerRecord(request));
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#ask(
      { method: DEVICE_METHOD.REGISTER, body: registerRecord(admitted) },
      (payload) => deviceRegisterAnswerSchema.parse(payload),
    );
  }

  heartbeat(request: DeviceHeartbeatRequest): Promise<DeviceHeartbeatAnswer | undefined> {
    const admitted = deviceHeartbeatRequestSchema.parse(heartbeatRecord(request));
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#ask(
      { method: DEVICE_METHOD.HEARTBEAT, body: heartbeatRecord(admitted) },
      (payload) => deviceHeartbeatAnswerSchema.parse(payload),
    );
  }

  /**
   * Forgets the row. At sign-out the account's credential is about to be
   * cleared, so the caller hands the departing token in rather than having it
   * read, and a refusal is final: there is no account left to refresh.
   */
  forget(
    request: DeviceForgetRequest,
    departing?: DepartingCredential,
  ): Promise<DeviceForgetAnswer | undefined> {
    const admitted = deviceForgetRequestSchema.parse(forgetRecord(request));
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#ask(
      { method: DEVICE_METHOD.FORGET, body: forgetRecord(admitted) },
      (payload) => deviceForgetAnswerSchema.parse(payload),
      departing,
    );
  }

  async #ask<Answer>(
    request: DeviceRequest,
    read: (payload: UnparsedWireValue) => Answer | undefined,
    departing?: DepartingCredential,
  ): Promise<Answer | undefined> {
    const token = departing?.accessToken ?? (await this.#readAccessToken());
    if (!token) return undefined;

    let response = await this.#request(request, token);
    if (response?.status === UNAUTHORIZED_STATUS && departing === undefined) {
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) {
        response = await this.#request(request, refreshed);
      }
    }
    if (!response?.ok) return undefined;

    const payload = await response.json().catch(() => undefined);
    return payload === undefined ? undefined : read(unparsedWire(payload));
  }

  async #request(request: DeviceRequest, token: string): Promise<Response | undefined> {
    try {
      return await this.#fetch(`${this.#baseUrl}${HOSTED_SERVICE_PATH.DEVICES}`, {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      return undefined;
    }
  }
}
