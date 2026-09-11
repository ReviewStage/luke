import type { CloudFetch, UnparsedWireValue, WireRecord } from "@sidecar/wire";
import {
  type AccountCall,
  accountBearer,
  type CallCredential,
  createAccountCall,
  fixedBearer,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type DeviceForgetAnswer,
  type DeviceForgetRequest,
  type DeviceRegisterAnswer,
  type DeviceRegisterRequest,
  deviceForgetAnswerSchema,
  deviceForgetRequestSchema,
  deviceRegisterAnswerSchema,
  deviceRegisterRequestSchema,
} from "./device-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

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

function forgetRecord(request: DeviceForgetRequest): WireRecord {
  return { deviceId: request.deviceId };
}

/**
 * The desktop's side of the device record: register this installation at
 * sign-in and forget it at sign-out; between the two, the change-signal poll
 * in `changes-client.ts` is what moves the row's last-seen instant.
 * Every ask is the shared account call — the token read fresh per attempt, a
 * 401 refreshed and retried once, every answer validated by the shared wire
 * contract — and a failure resolves to nothing, because no row press waits on
 * it: a registration that did not land is tried again by the next poll.
 * A request the service would refuse by shape is refused here without
 * traveling at all.
 */
export class HostedDeviceClient {
  readonly #options: HostedDeviceClientOptions;
  readonly #call: AccountCall;

  constructor(options: HostedDeviceClientOptions) {
    this.#options = options;
    this.#call = this.#callOn(accountBearer(options));
  }

  register(request: DeviceRegisterRequest): Promise<DeviceRegisterAnswer | undefined> {
    const admitted = deviceRegisterRequestSchema.parse(registerRecord(request));
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#ask(
      { method: DEVICE_METHOD.REGISTER, body: registerRecord(admitted) },
      (payload) => deviceRegisterAnswerSchema.parse(payload),
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

  #ask<Answer>(
    request: DeviceRequest,
    read: (payload: UnparsedWireValue) => Answer | undefined,
    departing?: DepartingCredential,
  ): Promise<Answer | undefined> {
    const call = departing ? this.#callOn(fixedBearer(departing.accessToken)) : this.#call;
    return call.ask(
      {
        method: request.method,
        path: HOSTED_SERVICE_PATH.DEVICES,
        body: JSON.stringify(request.body),
      },
      read,
    );
  }

  #callOn(credential: CallCredential): AccountCall {
    return createAccountCall({
      baseUrl: this.#options.serviceBaseUrl,
      credential,
      fetch: this.#options.fetch,
      requestTimeoutMs: this.#options.requestTimeoutMs,
    });
  }
}
