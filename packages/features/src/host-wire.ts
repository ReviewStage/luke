import { Schema as EffectSchema } from "effect";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "./device-agent-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * host-wire.ts -- how a host joins its member's devices, how it names itself on every call after, and the Hosts list Settings draws.
 *
 * A host is a device of kind host (`DEVICE_KIND`): a headless Linux box
 * with nobody signed in at it, which runs its member's local agents as the
 * desktop runs them on This Mac. The member mints an install token in
 * Settings, good for any number of boxes until it expires or is revoked;
 * each box trades it once, with the id it minted for itself, for a device
 * secret of its own (`hostEnrollRequestSchema`, `hostEnrollAnswerSchema`),
 * which the service keeps only as a hash. From then on the box calls the
 * device-agents procedures (`device-agent-wire.ts`) with that secret as its
 * bearer, and every call of a host, its enroll included, carries its
 * daemon's version (`HOST_WIRE.VERSION_HEADER`); one below the service's
 * floor is refused as needing an upgrade (`hostUpgradeNeededDataSchema`).
 */

export const HOST_WIRE = {
  /** What every install token begins with, so a box, a log scrubber, and a reader can tell one from any other secret. */
  INSTALL_TOKEN_PREFIX: "lkh_",
  /** What every device secret begins with, which is how the service tells a host's bearer from a desktop's sign-in. */
  DEVICE_SECRET_PREFIX: "lkd_",
  /** The header every call of a host carries its daemon's version in, as `MAJOR.MINOR.PATCH`. */
  VERSION_HEADER: "luke-host-version",
  /** The install script's path on the service's own origin, which PR 4 serves. */
  INSTALL_SCRIPT_PATH: "/install.sh",
} as const;

/** A daemon's version, as `MAJOR.MINOR.PATCH` with no leading zeros. */
const HOST_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u;

/** A daemon's version as its three numbers, or nothing where it is not `MAJOR.MINOR.PATCH`. */
export function readHostVersion(version: string): readonly [number, number, number] | undefined {
  const parts = HOST_VERSION.exec(version.trim());
  if (parts === null) return undefined;
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

/** Whether the version given is at or past the floor given, both `MAJOR.MINOR.PATCH`; a version that does not read is below any floor. */
export function hostVersionMeets(version: string, floor: string): boolean {
  const read = readHostVersion(version);
  const wanted = readHostVersion(floor);
  if (read === undefined || wanted === undefined) return false;
  for (let place = 0; place < 3; place += 1) {
    const [have, need] = [read[place] ?? 0, wanted[place] ?? 0];
    if (have !== need) return have > need;
  }
  return true;
}

/** A secret of the prefix given: the prefix and at least 32 more characters of base64url. */
function secretOf(prefix: string) {
  return EffectSchema.String.check(
    EffectSchema.isMaxLength(200),
    EffectSchema.makeFilter(
      (value: string) =>
        (value.startsWith(prefix) && /^[A-Za-z0-9_-]{32,}$/u.test(value.slice(prefix.length))) ||
        `a secret beginning ${prefix}`,
    ),
  );
}

/**
 * An enroll: the install token, the id the box minted for itself once and
 * keeps, its name (its hostname), and its platform and architecture. Its
 * daemon's version rides in `HOST_WIRE.VERSION_HEADER`, as on every call.
 */
export const hostEnrollRequestSchema = EffectSchema.Struct({
  installToken: secretOf(HOST_WIRE.INSTALL_TOKEN_PREFIX),
  deviceId: wireUuidSchema,
  name: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(200)),
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
});

export type HostEnrollRequest = typeof hostEnrollRequestSchema.Type;

/**
 * What an enroll answers: the device's id, and its secret, answered this
 * once and kept by the service only as a hash. The id of a host the member
 * removed may be enrolled again, which brings it back with a new secret; a
 * standing host's id is refused, so a token alone never takes over a box.
 */
export const hostEnrollAnswerSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  deviceSecret: secretOf(HOST_WIRE.DEVICE_SECRET_PREFIX),
});

export type HostEnrollAnswer = typeof hostEnrollAnswerSchema.Type;

/** What an upgrade-needed refusal carries beside its slug: the lowest daemon version the service takes. */
export const hostUpgradeNeededDataSchema = EffectSchema.Struct({
  minimumVersion: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * One of the member's hosts, as Settings lists it: its name, the epoch
 * milliseconds it was last seen, which a reader holds against its own clock
 * as it holds a Mac's (`macOnline`), the daemon version it last called with, none before its
 * first call that carried one, and whether that version is below the
 * service's floor.
 */
const hostSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  seenAt: countedNumber,
  version: EffectSchema.NullOr(EffectSchema.String),
  upgradeNeeded: EffectSchema.Boolean,
});

export type Host = typeof hostSchema.Type;

/** The member's hosts (GET), by name, and the install script's address on the service's own origin, which the upgrade command names. */
export const hostsAnswerSchema = EffectSchema.Struct({
  hosts: EffectSchema.Array(hostSchema),
  installScriptUrl: EffectSchema.String,
});

export type HostsAnswer = typeof hostsAnswerSchema.Type;

/** A SHA-256 in lowercase hex. */
const sha256Hex = EffectSchema.String.check(
  EffectSchema.makeFilter((value: string) => /^[0-9a-f]{64}$/u.test(value) || "a SHA-256 in hex"),
);

/**
 * An install token to keep (POST), by its SHA-256 alone: the member's own
 * Luke mints the token where the member is (`@luke/host`'s hosts composer)
 * and shows it there once, so the token itself never reaches the service.
 */
export const hostInstallTokenRequestSchema = EffectSchema.Struct({ tokenHash: sha256Hex });

/** What keeping an install token answers: its id, which revokes it, when it expires in epoch milliseconds, and the install script's address, which the command names. */
export const hostInstallTokenAnswerSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  expiresAt: countedNumber,
  installScriptUrl: EffectSchema.String,
});

export type HostInstallTokenAnswer = typeof hostInstallTokenAnswerSchema.Type;

/** An install token revoked, or a host removed, by its id. */
export const hostIdRequestSchema = EffectSchema.Struct({ id: wireUuidSchema });

/** What a revoke or a remove answers. */
export const hostDoneAnswerSchema = EffectSchema.Struct({ done: EffectSchema.Literal(true) });

/** The command that installs and enrolls a box as root, the install token in it. */
export function hostInstallCommand(installScriptUrl: string, installToken: string): string {
  return `curl -fsSL ${installScriptUrl} | sudo sh -s -- --token ${installToken}`;
}

/** The same command run over SSH on many servers, each named in the loop's list, for the member to fill in. */
export function hostInstallLoopCommand(installScriptUrl: string, installToken: string): string {
  return `for h in server-1 server-2 server-3; do ssh root@$h 'curl -fsSL ${installScriptUrl} | sh -s -- --token ${installToken}'; done`;
}

/** The command that upgrades an enrolled box in place, keeping its secret: the install command with no token. */
export function hostUpgradeCommand(installScriptUrl: string): string {
  return `curl -fsSL ${installScriptUrl} | sudo sh`;
}
