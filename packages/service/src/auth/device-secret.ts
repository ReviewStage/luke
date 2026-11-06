import { createHash, randomBytes, randomInt } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { hostBySecret, recordHostVersion } from "@repo/database/models/host-store";
import {
  HOST_USER_CODE,
  HOST_WIRE,
  hostVersionMeets,
  readHostVersion,
} from "@repo/features/host-wire";
import { Effect, Option } from "effect";
import {
  HOST_REMOVED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  hostUpgradeNeeded,
} from "../http/http-effect.js";
import { CREDENTIAL_HEADER } from "./session-credential.js";

export const HOST_VERSION = {
  FLOOR: "0.8.0",
} as const;

const SECRET_BYTES = 32;

const BEARER_PREFIX = "Bearer ";

export interface MintedSecret {
  readonly secret: string;
  readonly hash: string;
}

export interface HostCaller {
  readonly userId: string;
  readonly deviceId: string;
}

export function hostSecretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function mintHostSecret(prefix: string): MintedSecret {
  const secret = `${prefix}${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { secret, hash: hostSecretHash(secret) };
}

export function mintHostUserCode(): string {
  const { ALPHABET, LENGTH } = HOST_USER_CODE;
  return Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

function presentedBearer(request: Request, prefix: string): string | undefined {
  const authorization = request.headers.get(CREDENTIAL_HEADER.AUTHORIZATION)?.trim() ?? "";
  if (!authorization.startsWith(BEARER_PREFIX)) return undefined;
  const bearer = authorization.slice(BEARER_PREFIX.length).trim();
  return bearer.startsWith(prefix) ? bearer : undefined;
}

function presentedDeviceSecret(request: Request): string | undefined {
  return presentedBearer(request, HOST_WIRE.DEVICE_SECRET_PREFIX);
}

export function presentedPollSecret(request: Request): string | undefined {
  return presentedBearer(request, HOST_WIRE.POLL_SECRET_PREFIX);
}

export function presentedHostVersion(request: Request): string | undefined {
  const version = request.headers.get(HOST_WIRE.VERSION_HEADER)?.trim();
  return version === undefined || version.length === 0 ? undefined : version;
}

export function admittedHostVersion(
  version: string | undefined,
): Effect.Effect<string, HostedRefusal> {
  if (version !== undefined && hostVersionMeets(version, HOST_VERSION.FLOOR)) {
    return Effect.succeed(version);
  }
  return Effect.fail(hostUpgradeNeeded(HOST_VERSION.FLOOR));
}

export const hostCallerOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<Option.Option<HostCaller>, HostedRefusal, DatabaseServices> {
  const secret = presentedDeviceSecret(request);
  if (secret === undefined) return Option.none();
  const host = yield* hostedStoreOrUnavailable(hostBySecret(hostSecretHash(secret)));
  if (Option.isNone(host)) return yield* Effect.fail(HOST_REMOVED_REFUSAL);
  const version = presentedHostVersion(request);
  if (
    version !== undefined &&
    readHostVersion(version) !== undefined &&
    version !== host.value.version
  ) {
    yield* hostedStoreOrUnavailable(recordHostVersion(host.value.deviceId, version));
  }
  yield* admittedHostVersion(version);
  return Option.some({ userId: host.value.userId, deviceId: host.value.deviceId });
});
