import { Duration, Schema as EffectSchema } from "effect";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  DEVICE_SETUP_FAILURE_MAX_CHARS,
  deviceMachineFields,
  deviceSetupSchema,
  HOST_UPDATE_FAILURE_MAX_CHARS,
  hostUpdateSchema,
} from "./device-agent-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

export const HOST_WIRE = {
  DEVICE_SECRET_PREFIX: "lkd_",
  VERSION_HEADER: "vespin-host-version",
  INSTALL_SCRIPT_PATH: "/install.sh",
  INSTALL_SCRIPT_ROUTE: "/api/hosts/install-script",
  POLL_SECRET_PREFIX: "lkp_",
  CONNECT_PATH: "/connect",
} as const;

export const HOST_USER_CODE = {
  ALPHABET: "BCDFGHJKLMNPQRSTVWXZ",
  LENGTH: 8,
  SEPARATOR: "-",
} as const;

const USER_CODE_LETTERS = new RegExp(
  `^[${HOST_USER_CODE.ALPHABET}]{${HOST_USER_CODE.LENGTH}}$`,
  "u",
);

export function hostUserCodeOf(typed: string): string | undefined {
  const letters = typed.replace(/[\s-]/gu, "").toUpperCase();
  return USER_CODE_LETTERS.test(letters) ? letters : undefined;
}

export function shownHostUserCode(code: string): string {
  const half = HOST_USER_CODE.LENGTH / 2;
  return `${code.slice(0, half)}${HOST_USER_CODE.SEPARATOR}${code.slice(half)}`;
}

export function hostConnectPath(code: string): string {
  return `${HOST_WIRE.CONNECT_PATH}/${shownHostUserCode(code)}`;
}

const HOST_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u;

export function readHostVersion(version: string): readonly [number, number, number] | undefined {
  const parts = HOST_VERSION.exec(version.trim());
  if (parts === null) return undefined;
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

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

export const GITHUB_TOKEN_REFRESH = Duration.minutes(50);

export const hostGithubTokenRequestSchema = EffectSchema.Struct({ agentId: wireUuidSchema });

export type HostGithubTokenRequest = typeof hostGithubTokenRequestSchema.Type;

export const hostGithubTokenAnswerSchema = EffectSchema.Struct({
  githubToken: EffectSchema.String.check(EffectSchema.isMinLength(1)),
});

export type HostGithubTokenAnswer = typeof hostGithubTokenAnswerSchema.Type;

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

const enrollingMachineFields = {
  name: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(200)),
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
};

export const hostEnrollAnswerSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  deviceSecret: secretOf(HOST_WIRE.DEVICE_SECRET_PREFIX),
});

export type HostEnrollAnswer = typeof hostEnrollAnswerSchema.Type;

export const ownDeviceEnrollRequestSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  name: EffectSchema.optionalKey(enrollingMachineFields.name),
  platform: EffectSchema.optionalKey(enrollingMachineFields.platform),
  arch: EffectSchema.optionalKey(enrollingMachineFields.arch),
  ...deviceMachineFields,
});

export type OwnDeviceEnrollRequest = typeof ownDeviceEnrollRequestSchema.Type;

export const hostPairingStartRequestSchema = EffectSchema.Struct({
  ...enrollingMachineFields,
  ...deviceMachineFields,
});

export type HostPairingStartRequest = typeof hostPairingStartRequestSchema.Type;

export const hostPairingStartAnswerSchema = EffectSchema.Struct({
  pollSecret: secretOf(HOST_WIRE.POLL_SECRET_PREFIX),
  userCode: EffectSchema.String,
  url: EffectSchema.String,
  expiresInMs: countedNumber,
  intervalMs: countedNumber,
});

export type HostPairingStartAnswer = typeof hostPairingStartAnswerSchema.Type;

export const HOST_PAIRING_POLL_STATUS = {
  PENDING: "pending",
  SLOW_DOWN: "slow-down",
  APPROVED: "approved",
  DENIED: "denied",
  EXPIRED: "expired",
} as const;

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

export const hostPairingCodeRequestSchema = EffectSchema.Struct({
  code: EffectSchema.String.check(
    EffectSchema.isMaxLength(32),
    EffectSchema.makeFilter(
      (value: string) => hostUserCodeOf(value) !== undefined || "a code of eight letters",
    ),
  ),
});

export type HostPairingCodeRequest = typeof hostPairingCodeRequestSchema.Type;

export const hostPairingAnswerSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
  ip: EffectSchema.NullOr(EffectSchema.String),
  expiresAt: countedNumber,
});

export type HostPairingAnswer = typeof hostPairingAnswerSchema.Type;

export const hostPairingApproveAnswerSchema = EffectSchema.Struct({ deviceId: wireUuidSchema });

export type HostPairingApproveAnswer = typeof hostPairingApproveAnswerSchema.Type;

export const hostPairingHeldDataSchema = EffectSchema.Struct({
  heldUntil: EffectSchema.optionalKey(EffectSchema.Number),
});

export const hostRemovedDataSchema = EffectSchema.Struct({
  hostRemoved: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export const hostUpgradeNeededDataSchema = EffectSchema.Struct({
  minimumVersion: EffectSchema.optionalKey(EffectSchema.String),
});

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
  machineId: EffectSchema.optionalKey(EffectSchema.String),
  model: EffectSchema.optionalKey(EffectSchema.String),
});

export type Host = typeof hostSchema.Type;

export const hostsAnswerSchema = EffectSchema.Struct({
  hosts: EffectSchema.Array(hostSchema),
  installScriptUrl: EffectSchema.String,
});

export type HostsAnswer = typeof hostsAnswerSchema.Type;

export const devicePresenceAnswerSchema = EffectSchema.Struct({
  devices: EffectSchema.Array(
    EffectSchema.Struct({ deviceId: wireUuidSchema, ageMs: countedNumber }),
  ),
});

export type DevicePresenceAnswer = typeof devicePresenceAnswerSchema.Type;

export const hostIdRequestSchema = EffectSchema.Struct({ id: wireUuidSchema });

export const hostDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export function hostInstallCommand(installScriptUrl: string): string {
  return `curl -fsSL ${installScriptUrl} | sh`;
}

export function hostUpgradeCommand(installScriptUrl: string): string {
  return `curl -fsSL ${installScriptUrl} | sh`;
}

export const HOST_COMMAND = "~/.local/bin/vespin-host";

export const HOST_UNINSTALL_COMMAND = `${HOST_COMMAND} uninstall`;
