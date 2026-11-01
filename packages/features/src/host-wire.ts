import { Duration, Schema as EffectSchema } from "effect";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  DEVICE_SETUP_FAILURE_MAX_CHARS,
  deviceSetupSchema,
  HOST_UPDATE_FAILURE_MAX_CHARS,
  hostUpdateSchema,
} from "./device-agent-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * host-wire.ts -- how a host joins its member's devices, how it names itself on every call after, and the Hosts list Settings draws.
 *
 * A host is a device of kind host (`DEVICE_KIND`): a Linux box or a Mac the
 * install command set up, which runs its member's local agents as the
 * desktop runs them on This Mac. A box pairs with a code: it starts a
 * pairing with no credential (`hostPairingStartRequestSchema`) and is
 * answered a poll secret, a code to show, and the link that opens it on the
 * service's own origin (`hostConnectPath`); it polls on that secret
 * (`hostPairingPollAnswerSchema`) while a signed-in member opens the link
 * and approves or denies the code (`hostPairingCodeRequestSchema`). The
 * first poll after an approve is answered the box's device id and a device
 * secret of its own, this once, which the service keeps only as a hash. A
 * member's own Mac enrolls on its desktop's sign-in instead
 * (`ownDeviceEnrollRequestSchema`, `hostEnrollAnswerSchema`). From then on
 * the host calls the device-agents procedures (`device-agent-wire.ts`) with
 * that secret as its bearer, and every call of a host carries its daemon's
 * version (`HOST_WIRE.VERSION_HEADER`); one below the service's floor is
 * refused as needing an upgrade (`hostUpgradeNeededDataSchema`). A host has
 * no developer's git login, so it asks the same way for a GitHub token for
 * each agent it runs (`hostGithubTokenRequestSchema`).
 */

export const HOST_WIRE = {
  /** What every device secret begins with, which is how the service tells a host's bearer from a desktop's sign-in. */
  DEVICE_SECRET_PREFIX: "lkd_",
  /** The header every call of a host carries its daemon's version in, as `MAJOR.MINOR.PATCH`. */
  VERSION_HEADER: "luke-host-version",
  /** The install script's path on the service's own origin, which the web service rewrites onto `INSTALL_SCRIPT_ROUTE`. */
  INSTALL_SCRIPT_PATH: "/install.sh",
  /** The route that answers the install script, with the release and the origin it was asked on written in (`@luke/service/agents/host-install-script-app`). */
  INSTALL_SCRIPT_ROUTE: "/api/hosts/install-script",
  /** What every poll secret begins with: the bearer a pairing box polls on, which names its pairing and nothing else. */
  POLL_SECRET_PREFIX: "lkp_",
  /** The path of the page a pairing's link opens on the service's own origin, its code the segment after it (`hostConnectPath`), where a member approves or denies it. */
  CONNECT_PATH: "/connect",
} as const;

/**
 * A pairing's user code: eight letters of RFC 8628's twenty consonants, so
 * no code spells a word or holds a letter read as another, shown as two
 * groups of four (`shownHostUserCode`).
 */
export const HOST_USER_CODE = {
  ALPHABET: "BCDFGHJKLMNPQRSTVWXZ",
  LENGTH: 8,
  /** What stands between a shown code's two groups. */
  SEPARATOR: "-",
} as const;

/** A user code as its letters alone. */
const USER_CODE_LETTERS = new RegExp(
  `^[${HOST_USER_CODE.ALPHABET}]{${HOST_USER_CODE.LENGTH}}$`,
  "u",
);

/** A code as typed or as its link names it, read whatever its case, dashes, and spaces: its eight letters, upper case; nothing where it is no code. */
export function hostUserCodeOf(typed: string): string | undefined {
  const letters = typed.replace(/[\s-]/gu, "").toUpperCase();
  return USER_CODE_LETTERS.test(letters) ? letters : undefined;
}

/** A code's eight letters as a box shows them and its link names them: `XXXX-XXXX`. */
export function shownHostUserCode(code: string): string {
  const half = HOST_USER_CODE.LENGTH / 2;
  return `${code.slice(0, half)}${HOST_USER_CODE.SEPARATOR}${code.slice(half)}`;
}

/** The path of the page that approves the code given, on the service's own origin. */
export function hostConnectPath(code: string): string {
  return `${HOST_WIRE.CONNECT_PATH}/${shownHostUserCode(code)}`;
}

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

/**
 * How often a GitHub token handed for an agent's repository is renewed: the
 * cloud's sandbox credential (`CODER.GITHUB_TOKEN_REFRESH`) and a host's
 * agents alike. Fifty minutes, since an installation token lasts an hour and
 * a turn can last a day.
 */
export const GITHUB_TOKEN_REFRESH = Duration.minutes(50);

/**
 * A host's ask for a GitHub token for one of its agents, posted to
 * `HOSTED_SERVICE_PATH.RUNNER_TOKEN` on its device secret: the agent's id.
 * The service answers only for the host's own member's agent that runs on
 * that very host.
 */
export const hostGithubTokenRequestSchema = EffectSchema.Struct({ agentId: wireUuidSchema });

export type HostGithubTokenRequest = typeof hostGithubTokenRequestSchema.Type;

/**
 * What it answers: a GitHub App installation token cut to the agent's
 * repository, good for an hour from its mint, which the host signs the
 * agent's own `gh` in with and renews every `GITHUB_TOKEN_REFRESH`.
 */
export const hostGithubTokenAnswerSchema = EffectSchema.Struct({
  githubToken: EffectSchema.String.check(EffectSchema.isMinLength(1)),
});

export type HostGithubTokenAnswer = typeof hostGithubTokenAnswerSchema.Type;

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

/** What a joining machine names itself as: its name (its hostname), and its platform and architecture. */
const enrollingMachineFields = {
  name: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(200)),
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
};

/** What an own device's enroll answers: the device's id, and its secret, answered this once and kept by the service only as a hash. */
export const hostEnrollAnswerSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  deviceSecret: secretOf(HOST_WIRE.DEVICE_SECRET_PREFIX),
});

export type HostEnrollAnswer = typeof hostEnrollAnswerSchema.Type;

/**
 * An own device's enroll: the id of the member's machine, a Mac its desktop
 * signed in on, and its name, platform and architecture, which create the
 * device under the account where the account never registered the id; all
 * three or none, since a device the account already has needs none. The
 * desktop's own sign-in is its credential, as its bearer and never a
 * browser's session, and the version of the host program it enrolls for
 * rides in `HOST_WIRE.VERSION_HEADER`. It answers the device's id and its
 * new secret (`hostEnrollAnswerSchema`), a device the account has converted
 * in place under the same id so its agents keep it; a device already
 * enrolled is keyed again, its old secret refused from then on.
 */
export const ownDeviceEnrollRequestSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  name: EffectSchema.optionalKey(enrollingMachineFields.name),
  platform: EffectSchema.optionalKey(enrollingMachineFields.platform),
  arch: EffectSchema.optionalKey(enrollingMachineFields.arch),
});

export type OwnDeviceEnrollRequest = typeof ownDeviceEnrollRequestSchema.Type;

/**
 * A pairing started (POST), with no credential: the box's name (its
 * hostname), platform, and architecture, its daemon's version riding in
 * `HOST_WIRE.VERSION_HEADER` as on every call of a host's. The service
 * mints the device's id once a member approves; the box never names one.
 */
export const hostPairingStartRequestSchema = EffectSchema.Struct(enrollingMachineFields);

export type HostPairingStartRequest = typeof hostPairingStartRequestSchema.Type;

/**
 * What a start answers: the poll secret the box polls on as its bearer,
 * answered this once and kept by the service only as a hash; the code to
 * show, as `XXXX-XXXX`; the link that opens it; how long the code may be
 * approved, and how often to poll, both in milliseconds from the answer.
 */
export const hostPairingStartAnswerSchema = EffectSchema.Struct({
  pollSecret: secretOf(HOST_WIRE.POLL_SECRET_PREFIX),
  userCode: EffectSchema.String,
  url: EffectSchema.String,
  expiresInMs: countedNumber,
  intervalMs: countedNumber,
});

export type HostPairingStartAnswer = typeof hostPairingStartAnswerSchema.Type;

/** Where a pairing stands as its poll answers it. */
export const HOST_PAIRING_POLL_STATUS = {
  /** No member has approved or denied the code yet; poll again after the interval. */
  PENDING: "pending",
  /** The poll came sooner than the interval after the last; wait longer between polls. */
  SLOW_DOWN: "slow-down",
  /** A member approved the code: the device's id and secret, answered this once. */
  APPROVED: "approved",
  /** A member denied the code, or removed the host before the box collected it. */
  DENIED: "denied",
  /** The code lapsed unapproved, or the poll secret names no pairing that stands, one handed over included. */
  EXPIRED: "expired",
} as const;

/**
 * What a poll answers (POST, on the poll secret as its bearer and no body):
 * where the pairing stands, and once approved, the device's id and its
 * secret, which the box calls on from then on.
 */
export const hostPairingPollAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    status: EffectSchema.Literals([
      HOST_PAIRING_POLL_STATUS.PENDING,
      HOST_PAIRING_POLL_STATUS.SLOW_DOWN,
      HOST_PAIRING_POLL_STATUS.DENIED,
      HOST_PAIRING_POLL_STATUS.EXPIRED,
    ]),
  }),
  EffectSchema.Struct({
    status: EffectSchema.Literal(HOST_PAIRING_POLL_STATUS.APPROVED),
    deviceId: wireUuidSchema,
    deviceSecret: secretOf(HOST_WIRE.DEVICE_SECRET_PREFIX),
  }),
]);

export type HostPairingPollAnswer = typeof hostPairingPollAnswerSchema.Type;

/**
 * A pairing read, approved, or denied by its code (POST), on the member's
 * own sign-in or browser session: the code as typed or as its link names
 * it, read whatever its case and dash (`hostUserCodeOf`). It rides in the
 * body rather than the address, so no log of addresses keeps it.
 */
export const hostPairingCodeRequestSchema = EffectSchema.Struct({
  code: EffectSchema.String.check(
    EffectSchema.isMaxLength(32),
    EffectSchema.makeFilter(
      (value: string) => hostUserCodeOf(value) !== undefined || "a code of eight letters",
    ),
  ),
});

export type HostPairingCodeRequest = typeof hostPairingCodeRequestSchema.Type;

/**
 * A pending pairing as the approve screen shows it, so a member sees what
 * they would let run their agents: the box's name, platform, and
 * architecture as it named them, the address its start came from, none
 * where the service read none, and when its code lapses, in epoch
 * milliseconds.
 */
export const hostPairingAnswerSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
  ip: EffectSchema.NullOr(EffectSchema.String),
  expiresAt: countedNumber,
});

export type HostPairingAnswer = typeof hostPairingAnswerSchema.Type;

/** What an approve answers: the id of the host it made, listed among the member's hosts from now on. */
export const hostPairingApproveAnswerSchema = EffectSchema.Struct({ deviceId: wireUuidSchema });

export type HostPairingApproveAnswer = typeof hostPairingApproveAnswerSchema.Type;

/** What a held refusal of a read, an approve, or a deny carries beside its slug: when the account's guesses are taken again, in epoch milliseconds. */
export const hostPairingHeldDataSchema = EffectSchema.Struct({
  heldUntil: EffectSchema.optionalKey(EffectSchema.Number),
});

/** What an upgrade-needed refusal carries beside its slug: the lowest daemon version the service takes. */
export const hostUpgradeNeededDataSchema = EffectSchema.Struct({
  minimumVersion: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * One of the member's enrolled machines, as Settings lists it: its name,
 * its platform, which its copy and glyph follow, absent from a service
 * older than it, which listed only Linux boxes, the epoch
 * milliseconds it was last seen, which a reader holds against its own clock
 * as a Mac's, which a window does not judge by (`deviceStanding`), the daemon version it last called with, none before its
 * first call that carried one, and whether that version is below the
 * service's floor. A machine still setting itself up says where that
 * stands (`DEVICE_SETUP`), and why for one that failed, as Start's offer of
 * it does (`macOfferSchema`); both are absent for a ready one. A machine
 * whose host program has not called in since it joined says so
 * (`calledIn`): a host an approve made, or one whose box collected its
 * secret, until its program first registers. All three are absent from a
 * service older than them. A
 * machine updating itself to a newer release says where that stands
 * (`HOST_UPDATE`), and why for one that failed, as its last beat said; both
 * are absent while no update is under way, and from a service older than
 * them.
 */
const hostSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  platform: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(DEVICE_PLATFORM))),
  seenAt: countedNumber,
  version: EffectSchema.NullOr(EffectSchema.String),
  upgradeNeeded: EffectSchema.Boolean,
  setup: EffectSchema.optionalKey(deviceSetupSchema),
  setupFailure: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(DEVICE_SETUP_FAILURE_MAX_CHARS)),
  ),
  calledIn: EffectSchema.optionalKey(EffectSchema.Boolean),
  update: EffectSchema.optionalKey(hostUpdateSchema),
  updateFailure: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(HOST_UPDATE_FAILURE_MAX_CHARS)),
  ),
});

export type Host = typeof hostSchema.Type;

/** The member's enrolled machines (GET), Linux boxes and Macs alike, by name, and the install script's address on the service's own origin, which the upgrade command names. */
export const hostsAnswerSchema = EffectSchema.Struct({
  hosts: EffectSchema.Array(hostSchema),
  installScriptUrl: EffectSchema.String,
});

export type HostsAnswer = typeof hostsAnswerSchema.Type;

/**
 * How long ago each of the reader's own devices last beat, in milliseconds
 * on the service's own clock, and nothing else of it. A window ages this on
 * its own monotonic clock rather than comparing a timestamp with its wall
 * clock, so a window whose clock is off judges the same as one whose clock is
 * right. A device that is gone, has not registered, or is a teammate's is
 * left out: the window cannot speak for it.
 */
export const devicePresenceAnswerSchema = EffectSchema.Struct({
  devices: EffectSchema.Array(
    EffectSchema.Struct({ deviceId: wireUuidSchema, ageMs: countedNumber }),
  ),
});

export type DevicePresenceAnswer = typeof devicePresenceAnswerSchema.Type;

/** A host removed, by its id. */
export const hostIdRequestSchema = EffectSchema.Struct({ id: wireUuidSchema });

/** What a remove or a deny answers. */
export const hostDoneAnswerSchema = EffectSchema.Struct({ done: EffectSchema.Literal(true) });

/** The command that installs the host program on a box and pairs it, which prints the link and the code a member approves: public, with no secret in it. */
export function hostInstallCommand(installScriptUrl: string): string {
  return `curl -fsSL ${installScriptUrl} | sh`;
}

/** The command that upgrades a connected box in place, keeping its pairing: the install script run again in the account it installed into, with no sudo. */
export function hostUpgradeCommand(installScriptUrl: string): string {
  return `curl -fsSL ${installScriptUrl} | sh`;
}

/** The command that takes Luke's host out of the account the install command set it up in, with no sudo: its service, its agents' folders, its state and its releases (`apps/host/scripts/luke-host.sh`). Note that it names the install's own link, since the account's PATH may not hold `~/.local/bin`. */
export const HOST_UNINSTALL_COMMAND = "~/.local/bin/luke-host uninstall";
