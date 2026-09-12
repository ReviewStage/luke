import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import type * as HttpClient from "@effect/platform/HttpClient";
import type { WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, type Schema as EffectSchema, Either, type Layer } from "effect";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  type CallCredential,
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
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
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
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: HostedDeviceClientOptions) {
    this.#options = options;
    this.#call = this.#callOn(accountBearer(options));
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  register(request: DeviceRegisterRequest): Promise<DeviceRegisterAnswer | undefined> {
    const admitted = Either.getOrUndefined(
      readEither(deviceRegisterRequestSchema)(registerRecord(request)),
    );
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#ask(
      { method: DEVICE_METHOD.REGISTER, body: registerRecord(admitted) },
      deviceRegisterAnswerSchema,
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
    const admitted = Either.getOrUndefined(
      readEither(deviceForgetRequestSchema)(forgetRecord(request)),
    );
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#ask(
      { method: DEVICE_METHOD.FORGET, body: forgetRecord(admitted) },
      deviceForgetAnswerSchema,
      departing,
    );
  }

  #ask<Answer, Encoded>(
    request: DeviceRequest,
    answer: EffectSchema.Schema<Answer, Encoded>,
    departing?: DepartingCredential,
  ): Promise<Answer | undefined> {
    const call = departing ? this.#callOn(fixedBearer(departing.accessToken)) : this.#call;
    return Effect.runPromise(
      Effect.provide(
        call.ask(
          {
            method: request.method,
            path: HOSTED_SERVICE_PATH.DEVICES,
            body: JSON.stringify(request.body),
          },
          answer,
        ),
        this.#client,
      ),
    );
  }

  #callOn(credential: CallCredential): AccountCallEffects {
    return accountCall({
      baseUrl: this.#options.serviceBaseUrl,
      credential,
      requestTimeoutMs: this.#options.requestTimeoutMs,
    });
  }
}
