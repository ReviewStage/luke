import { createHash, randomBytes } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { hostBySecret, recordHostVersion } from "@luke/database/models/host-store";
import { HOST_WIRE, hostVersionMeets, readHostVersion } from "@luke/features/host-wire";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  hostUpgradeNeeded,
} from "../http/http-effect.js";
import { CREDENTIAL_HEADER } from "./session-credential.js";

/**
 * device-secret.ts -- a host's own credentials: minting an install token or a device secret, and reading the host a request's bearer names.
 *
 * A host calls the service on a device secret (`@luke/features/host-wire`),
 * as `Authorization: Bearer lkd_…`, never the desktop's sign-in, and with
 * its daemon's version in `HOST_WIRE.VERSION_HEADER` on every call. Both
 * the install token a box enrolls with and the secret it is answered are
 * minted here, answered once, and kept by the store only as their SHA-256
 * (`@luke/database/models/host-store`), so a secret is looked up by its
 * hash and a database read never yields one.
 *
 * `hostCallerOf` is the one door every host-facing route reads its caller
 * through, the device-agents procedures and the runner token route alike:
 * a bearer that is no device secret is none of its business, and answers
 * nothing so the route reads the desktop's sign-in instead; a device secret
 * that names no standing host (unknown, or its host removed) is
 * refused at once; and a host whose daemon is below `HOST_VERSION.FLOOR`,
 * or sent no version, is refused as needing an upgrade, after its version
 * was recorded, so its Hosts row says which it runs.
 */

export const HOST_VERSION = {
  /** The lowest daemon version the service takes a call from. Raise it when a daemon below it would break against this service. */
  FLOOR: "0.1.0",
} as const;

/** The bytes of randomness behind an install token and a device secret. */
const SECRET_BYTES = 32;

/** What every bearer begins with. */
const BEARER_PREFIX = "Bearer ";

/** A secret, answered once, and the hash the store keeps of it. */
export interface MintedSecret {
  readonly secret: string;
  readonly hash: string;
}

/** The host a device secret named: its device, its account, and the version it called with. */
export interface HostCaller {
  readonly userId: string;
  readonly deviceId: string;
}

/** A secret's SHA-256 in hex, which is all the store keeps of it. */
export function hostSecretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A fresh secret of the prefix given (`HOST_WIRE.INSTALL_TOKEN_PREFIX`, `HOST_WIRE.DEVICE_SECRET_PREFIX`), and its hash. */
export function mintHostSecret(prefix: string): MintedSecret {
  const secret = `${prefix}${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { secret, hash: hostSecretHash(secret) };
}

/** The secret of the prefix given a request's bearer carries, or nothing where it carries another bearer or none. */
function presentedBearer(request: Request, prefix: string): string | undefined {
  const authorization = request.headers.get(CREDENTIAL_HEADER.AUTHORIZATION)?.trim() ?? "";
  if (!authorization.startsWith(BEARER_PREFIX)) return undefined;
  const bearer = authorization.slice(BEARER_PREFIX.length).trim();
  return bearer.startsWith(prefix) ? bearer : undefined;
}

/** The device secret a request's bearer carries, or nothing where it carries another bearer or none. */
function presentedDeviceSecret(request: Request): string | undefined {
  return presentedBearer(request, HOST_WIRE.DEVICE_SECRET_PREFIX);
}

/** The install token an enroll's bearer carries, or nothing where it carries another bearer or none. */
export function presentedInstallToken(request: Request): string | undefined {
  return presentedBearer(request, HOST_WIRE.INSTALL_TOKEN_PREFIX);
}

/** The daemon version a request carries, trimmed, or nothing where it carries none. */
export function presentedHostVersion(request: Request): string | undefined {
  const version = request.headers.get(HOST_WIRE.VERSION_HEADER)?.trim();
  return version === undefined || version.length === 0 ? undefined : version;
}

/**
 * The daemon version given, where it is at or past the floor; refused as
 * needing an upgrade otherwise, one that sent no version, or one that does
 * not read as `MAJOR.MINOR.PATCH`, alike.
 */
export function admittedHostVersion(
  version: string | undefined,
): Effect.Effect<string, HostedRefusal> {
  if (version !== undefined && hostVersionMeets(version, HOST_VERSION.FLOOR)) {
    return Effect.succeed(version);
  }
  return Effect.fail(hostUpgradeNeeded(HOST_VERSION.FLOOR));
}

/**
 * The host a request's device secret names, on the terms above: nothing
 * where its bearer is no device secret, the host where it names a standing
 * one whose daemon is at or past the floor, and refused otherwise.
 */
export const hostCallerOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<Option.Option<HostCaller>, HostedRefusal, DatabaseServices> {
  const secret = presentedDeviceSecret(request);
  if (secret === undefined) return Option.none();
  const host = yield* hostedStoreOrUnavailable(hostBySecret(hostSecretHash(secret)));
  if (Option.isNone(host)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const version = presentedHostVersion(request);
  // Note that only a version that reads is recorded, so a header of junk never lands on the Hosts row.
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
