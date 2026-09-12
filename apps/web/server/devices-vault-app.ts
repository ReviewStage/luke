import { randomUUID } from "node:crypto";
import { type HttpApp, HttpRouter, HttpServerRequest } from "@effect/platform";
import type { SqlClient } from "@effect/sql";
import { readEither } from "@sidecar/wire/effect";
import { Effect, type Schema as EffectSchema, Either, Redacted } from "effect";
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
  hostedRefusalResponse,
  readJsonBodyEffect,
} from "./hosted/http-effect.js";
import { createRateBrake } from "./hosted/rate-brake.js";

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

const deviceRateLimited = createRateBrake({
  windowMs: DEVICE_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: DEVICE_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: DEVICE_RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface DevicesVaultSeams extends DeviceSeams {
  /** Reads the signed-in account behind the request's bearer, or nothing. */
  resolveUserId: (authorization: string | undefined) => Promise<string | undefined>;
  storeKey: (userId: string, providerId: string, ciphertext: string) => Promise<void>;
  listKeys: (userId: string) => Promise<{ providerId: string; updatedAt: Date }[]>;
  deleteKey: (userId: string, providerId: string) => Promise<boolean>;
  now?: () => number;
  mintId?: () => string;
}

/** The signed-in account behind the request's bearer, or the invalid-token refusal. */
function bearerUserId(
  seams: Pick<DevicesVaultSeams, "resolveUserId">,
): Effect.Effect<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const userId = yield* Effect.promise(() => seams.resolveUserId(request.headers.authorization));
    if (!userId) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return userId;
  });
}

/** Decodes a wire body through its Effect declaration, refusing anything it does not read. */
function decodeBody<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  payload: UnparsedWireValue,
): Effect.Effect<Value, HostedRefusal> {
  return Either.match(readEither(schema)(payload), {
    onLeft: () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST),
    onRight: Effect.succeed,
  });
}

/**
 * Dispatches the one path's three device methods. The gate order is the
 * shared one: method, bearer, brake, body. A body that is not the method's
 * documented shape is one 400 whatever was wrong with it, so a refused
 * request tells a caller nothing about which field the service reads.
 */
function devicesEffect(seams: DevicesVaultSeams): HttpApp.Default<never, SqlClient.SqlClient> {
  return Effect.gen(function* () {
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
    const now = seams.now ?? Date.now;
    if (yield* Effect.promise(() => deviceRateLimited(userId))) {
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
        seams.registerDevice(userId, registration, mintId, new Date(now())),
      );
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deviceId });
    }

    if (method === DEVICE_METHOD.HEARTBEAT) {
      const body = yield* decodeBody(deviceHeartbeatRequestSchema, payload);
      const seen = yield* Effect.orDie(
        seams.touchDevice(userId, heartbeatFrom(body), new Date(now())),
      );
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { seen });
    }

    const body = yield* decodeBody(deviceForgetRequestSchema, payload);
    const deleted = yield* Effect.orDie(seams.forgetDevice(userId, body.deviceId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
  }).pipe(Effect.catchAll((refusal) => Effect.succeed(hostedRefusalResponse(refusal))));
}

/** The vault's encryption secret, read from the environment, or the unavailable refusal without one. */
function vaultSecret(): Effect.Effect<string, HostedRefusal, HostedEnvironment> {
  return Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    if (environment.providerKeyEncryptionSecret === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    return Redacted.value(environment.providerKeyEncryptionSecret);
  });
}

/**
 * A valid provider key, by the shape rule the wire contract fixes for both
 * sides. Loose by design — never provider-specific format.
 */
function parseProviderKey(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value) || !vaultKeyIsStorable(value)) return undefined;
  return value;
}

/** Stores, replaces, or deletes the provider API key for the signed-in user. */
function vaultKeyEffect(
  seams: DevicesVaultSeams,
): HttpApp.Default<never, HostedEnvironment | SqlClient.SqlClient> {
  return Effect.gen(function* () {
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
      const deleted = yield* Effect.promise(() => seams.deleteKey(userId, providerId));
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted });
    }

    const key = parseProviderKey(payload.key);
    if (!key) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const ciphertext = encryptProviderKey(key, secret);
    yield* Effect.promise(() => seams.storeKey(userId, providerId, ciphertext));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { stored: true });
  }).pipe(Effect.catchAll((refusal) => Effect.succeed(hostedRefusalResponse(refusal))));
}

/** Lists stored provider keys for the signed-in user. Never returns ciphertext or plaintext. */
function vaultKeysEffect(
  seams: DevicesVaultSeams,
): HttpApp.Default<never, HostedEnvironment | SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== "GET") return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    yield* vaultSecret();
    const userId = yield* bearerUserId(seams);
    const rows = yield* Effect.promise(() => seams.listKeys(userId));
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
  }).pipe(Effect.catchAll((refusal) => Effect.succeed(hostedRefusalResponse(refusal))));
}

/**
 * The group: the device row's three writes on one path, the vault key's
 * store-and-delete on another, its list on a third, and the hosted
 * vocabulary's own refusal anywhere else. Nothing routes another path to
 * this function, so the refusal says what the group declares rather than
 * what a caller can reach.
 */
export function devicesVaultApp(
  seams: DevicesVaultSeams,
): HttpApp.Default<never, HostedEnvironment | SqlClient.SqlClient> {
  return HttpRouter.empty.pipe(
    HttpRouter.all(DEVICES_PATH, devicesEffect(seams)),
    HttpRouter.all(VAULT_KEY_PATH, vaultKeyEffect(seams)),
    HttpRouter.all(VAULT_KEYS_PATH, vaultKeysEffect(seams)),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
