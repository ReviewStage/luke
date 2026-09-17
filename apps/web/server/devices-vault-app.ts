import { randomUUID } from "node:crypto";
import { readEither } from "@sidecar/wire/effect";
import {
  Clock,
  Effect,
  type Schema as EffectSchema,
  Layer,
  Option,
  Redacted,
  Result,
} from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import {
  DEVICE_METHOD,
  deviceForgetRequestSchema,
  deviceHeartbeatRequestSchema,
  deviceRegisterRequestSchema,
  isCloudAgentProviderId,
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  vaultKeyIsStorable,
} from "./core.js";
import {
  type DeviceRegistration,
  type DeviceSeams,
  heartbeatFrom,
  pushAddress,
} from "./hosted/devices.js";
import { encryptProviderKey } from "./hosted/encryption.js";
import { HostedEnvironment } from "./hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  readJsonBodyEffect,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { makeRateBrake } from "./hosted/rate-brake.js";
import type { VaultKeyEffect } from "./hosted/vault-key-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * The device record's three writes and the provider key vault's three, on
 * three paths: `/api/devices` (register, heartbeat, forget), `/api/vault/key`
 * (store, delete), and `/api/vault/keys` (list). The bearer token names the
 * account and nothing in a body can choose another; every row the seams
 * touch is scoped to that account. The device brake is generous enough for
 * every device a person owns to heartbeat every few minutes and tight enough
 * that a client stuck in a loop is a trickle.
 */

const DEVICES_PATH = "/api/devices";
const VAULT_KEY_PATH = "/api/vault/key";
const VAULT_KEYS_PATH = "/api/vault/keys";

/** A poll or a key body is a handful of short fields; anything heavier is not one. */
const MAXIMUM_DEVICES_BODY_BYTES = 8_192;
const MAXIMUM_VAULT_BODY_BYTES = 8_192;

const DEVICE_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 60,
  MAX_TRACKED_USERS: 10_000,
} as const;

const deviceBrake = makeRateBrake({
  windowMs: DEVICE_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: DEVICE_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: DEVICE_RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface DevicesVaultSeams extends DeviceSeams {
  /** Reads the signed-in account behind the request's bearer, or nothing. */
  resolveUserId: UserIdResolver<string | undefined>;
  storeKey: (userId: string, providerId: string, ciphertext: string) => VaultKeyEffect<void>;
  listKeys: (userId: string) => VaultKeyEffect<{ providerId: string; updatedAt: Date }[]>;
  deleteKey: (userId: string, providerId: string) => VaultKeyEffect<boolean>;
  mintId?: () => string;
}

/** The signed-in account behind the request's bearer, or the invalid-token refusal. */
const bearerUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: Pick<DevicesVaultSeams, "resolveUserId">,
): Effect.fn.Return<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const account = yield* seams.resolveUserId(request.headers.authorization);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** Decodes a wire body through its Effect declaration, refusing anything it does not read. */
function decodeBody<Value, Encoded>(
  schema: EffectSchema.Codec<Value, Encoded>,
  payload: UnparsedWireValue,
): Effect.Effect<Value, HostedRefusal> {
  return Result.match(readEither(schema)(payload), {
    onFailure: () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST),
    onSuccess: Effect.succeed,
  });
}

/**
 * Dispatches the one path's three device methods. The gate order is the
 * shared one: method, bearer, brake, body. A body that is not the method's
 * documented shape is one 400 whatever was wrong with it, so a refused
 * request tells a caller nothing about which field the service reads.
 */
const devicesEffect = /* @__PURE__ */ Effect.fn("devicesEffect")(
  function* (
    seams: DevicesVaultSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    SqlClient.SqlClient | HttpServerRequest.HttpServerRequest
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const method = request.method;
    if (
      method !== DEVICE_METHOD.REGISTER &&
      method !== DEVICE_METHOD.HEARTBEAT &&
      method !== DEVICE_METHOD.FORGET
    ) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const userId = yield* bearerUserId(seams);
    if (!(yield* deviceBrake.check(userId))) {
      return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
    }
    const mintId = seams.mintId ?? randomUUID;
    const payload = yield* readJsonBodyEffect(MAXIMUM_DEVICES_BODY_BYTES);

    if (method === DEVICE_METHOD.REGISTER) {
      const body = yield* decodeBody(deviceRegisterRequestSchema, payload);
      const registration: DeviceRegistration = {
        installationId: body.installationId,
        platform: body.platform,
        push: pushAddress(body),
      };
      const { deviceId } = yield* Effect.orDie(
        seams.registerDevice(
          userId,
          registration,
          mintId,
          new Date(yield* Clock.currentTimeMillis),
        ),
      );
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deviceId });
    }

    if (method === DEVICE_METHOD.HEARTBEAT) {
      const body = yield* decodeBody(deviceHeartbeatRequestSchema, payload);
      const seen = yield* Effect.orDie(
        seams.touchDevice(userId, heartbeatFrom(body), new Date(yield* Clock.currentTimeMillis)),
      );
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { seen });
    }

    const body = yield* decodeBody(deviceForgetRequestSchema, payload);
    const deleted = yield* Effect.orDie(seams.forgetDevice(userId, body.deviceId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
  },
  Effect.catch((refusal) => Effect.succeed(hostedRefusalResponse(refusal))),
);

/** The vault's encryption secret, read from the environment, or the unavailable refusal without one. */
const vaultSecret = /* @__PURE__ */ Effect.fnUntraced(function* (): Effect.fn.Return<
  string,
  HostedRefusal,
  HostedEnvironment
> {
  const environment = yield* HostedEnvironment;
  if (environment.providerKeyEncryptionSecret === undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  return Redacted.value(environment.providerKeyEncryptionSecret);
});

/**
 * A valid provider key, by the shape rule the wire contract fixes for both
 * sides. Loose by design — never provider-specific format.
 */
function parseProviderKey(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value) || !vaultKeyIsStorable(value)) return undefined;
  return value;
}

/** Stores, replaces, or deletes the provider API key for the signed-in user. */
const vaultKeyEffect = /* @__PURE__ */ Effect.fn("vaultKeyEffect")(
  function* (
    seams: DevicesVaultSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HostedEnvironment | SqlClient.SqlClient | HttpServerRequest.HttpServerRequest
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "POST" && request.method !== "DELETE") {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const secret = yield* vaultSecret();
    const userId = yield* bearerUserId(seams);
    const payload = yield* readJsonBodyEffect(MAXIMUM_VAULT_BODY_BYTES);
    if (!isRecord(payload)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const providerId = text(payload.providerId);
    if (!isCloudAgentProviderId(providerId)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    if (request.method === "DELETE") {
      const deleted = yield* Effect.orDie(seams.deleteKey(userId, providerId));
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
    }

    const key = parseProviderKey(payload.key);
    if (!key) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const ciphertext = encryptProviderKey(key, secret);
    yield* Effect.orDie(seams.storeKey(userId, providerId, ciphertext));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { stored: true });
  },
  Effect.catch((refusal) => Effect.succeed(hostedRefusalResponse(refusal))),
);

/** Lists stored provider keys for the signed-in user. Never returns ciphertext or plaintext. */
const vaultKeysEffect = /* @__PURE__ */ Effect.fn("vaultKeysEffect")(
  function* (
    seams: DevicesVaultSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HostedEnvironment | SqlClient.SqlClient | HttpServerRequest.HttpServerRequest
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "GET") return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    yield* vaultSecret();
    const userId = yield* bearerUserId(seams);
    const rows = yield* Effect.orDie(seams.listKeys(userId));
    // The table outlives the provider set: a key stored for a provider this
    // build no longer accepts still has a row, and both clients' readers drop
    // the whole answer on an id they do not know. The list answers only for
    // the providers the wire contract names, and a stale row is held silently
    // rather than surfaced as a key that cannot be deleted or used.
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      keys: rows
        .filter((row) => isCloudAgentProviderId(row.providerId))
        .map((row) => ({ providerId: row.providerId, updatedAt: row.updatedAt.getTime() })),
    });
  },
  Effect.catch((refusal) => Effect.succeed(hostedRefusalResponse(refusal))),
);

/**
 * The group: the device row's three writes on one path, the vault key's
 * store-and-delete on another, its list on a third, and the hosted
 * vocabulary's own refusal anywhere else. Nothing routes another path to
 * this function, so the refusal says what the group declares rather than
 * what a caller can reach.
 */
export function devicesVaultApp(
  seams: DevicesVaultSeams,
): WebRoutes<HostedEnvironment | SqlClient.SqlClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, DEVICES_PATH, devicesEffect(seams)),
    HttpRouter.add(ANY_METHOD, VAULT_KEY_PATH, vaultKeyEffect(seams)),
    HttpRouter.add(ANY_METHOD, VAULT_KEYS_PATH, vaultKeysEffect(seams)),
    hostedNotFoundRoute,
  );
}
