import { Schema as EffectSchema } from "effect";
import { checkoutIdentitySchema } from "./checkout-identity.js";
import type { GitHubAccess } from "./github-repositories-wire.js";
import { HOST_TARGET } from "./host-release.js";
import { wireUuidSchema } from "./service-wire.js";

export const DEVICE_AGENT_BOUNDS = {
  MAX_ANSWER_BYTES: 8 * 1024 * 1024,
  MAX_FILES_LINE_BYTES: 3_000_000,
  MAX_LINES_READ_BYTES: 2_000_000,
} as const;

export const DEVICE_AGENT_LINE_KIND = {
  LAUNCH: "launch",
  MESSAGE: "message",
  STOP: "stop",
  RETUNE: "retune",
  FILES: "files",
  DISCARD: "discard",
} as const;

export type DeviceAgentLineKind =
  (typeof DEVICE_AGENT_LINE_KIND)[keyof typeof DEVICE_AGENT_LINE_KIND];

export const DEVICE_LAUNCH_STEP = {
  PREPARING: "preparing",
  FETCHING: "fetching",
  STARTING: "starting",
} as const;

export type DeviceLaunchStep = (typeof DEVICE_LAUNCH_STEP)[keyof typeof DEVICE_LAUNCH_STEP];

export const DEVICE_LAUNCH_STEPS: readonly DeviceLaunchStep[] = Object.values(DEVICE_LAUNCH_STEP);

export const DEVICE_LAUNCH_UNSTARTED = {
  GITHUB_SIGN_IN: "github-sign-in",
} as const;

export type DeviceLaunchUnstarted =
  (typeof DEVICE_LAUNCH_UNSTARTED)[keyof typeof DEVICE_LAUNCH_UNSTARTED];

export const DEVICE_GITHUB_ACCESS = {
  TOKEN: "token",
} as const satisfies Record<string, GitHubAccess>;

export const DEVICE_AGENT_REQUEST_KIND = {
  READ_FILE: "read_file",
} as const;

export type DeviceAgentRequestKind =
  (typeof DEVICE_AGENT_REQUEST_KIND)[keyof typeof DEVICE_AGENT_REQUEST_KIND];

export const DEVICE_CAPABILITY = {
  DISCARD: "discard",
  GITHUB_SIGN_IN: "github-sign-in",
} as const;

export type DeviceCapability = (typeof DEVICE_CAPABILITY)[keyof typeof DEVICE_CAPABILITY];

export const DEVICE_AGENT_LINE_CAPABILITY: Partial<Record<DeviceAgentLineKind, DeviceCapability>> =
  {
    [DEVICE_AGENT_LINE_KIND.DISCARD]: DEVICE_CAPABILITY.DISCARD,
  };

export const DEVICE_KIND = {
  DESKTOP: "desktop",
  HOST: "host",
} as const;

export type DeviceKind = (typeof DEVICE_KIND)[keyof typeof DEVICE_KIND];

export const DEVICE_SETUP = {
  PREPARING: "preparing",
  FAILED: "failed",
} as const;

export type DeviceSetup = (typeof DEVICE_SETUP)[keyof typeof DEVICE_SETUP];

export const deviceSetupSchema = EffectSchema.Literals(Object.values(DEVICE_SETUP));

export const DEVICE_SETUP_FAILURE_MAX_CHARS = 200;

export const HOST_UPDATE = {
  WAITING: "waiting",
  UPDATING: "updating",
  FAILED: "failed",
} as const;

export type HostUpdate = (typeof HOST_UPDATE)[keyof typeof HOST_UPDATE];

export const hostUpdateSchema = EffectSchema.Literals(Object.values(HOST_UPDATE));

export const HOST_UPDATE_FAILURE_MAX_CHARS = 200;

export const DEVICE_PLATFORM = {
  DARWIN: "darwin",
  LINUX: "linux",
} as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];

export const DEVICE_ARCH = {
  ARM64: "arm64",
  X64: "x64",
} as const;

export type DeviceArch = (typeof DEVICE_ARCH)[keyof typeof DEVICE_ARCH];

export const DEVICE_MODEL_MAX_CHARS = 200;

export const deviceMachineFields = {
  machineId: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{64}$/u)),
  ),
  model: EffectSchema.optionalKey(
    EffectSchema.String.check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(DEVICE_MODEL_MAX_CHARS),
    ),
  ),
};

const deviceMachineSchema = EffectSchema.Struct(deviceMachineFields);

export type DeviceMachine = typeof deviceMachineSchema.Type;

export const deviceAgentObjectSchema = EffectSchema.Record(
  EffectSchema.String,
  EffectSchema.Unknown,
);

export type DeviceAgentObject = typeof deviceAgentObjectSchema.Type;

export const deviceAgentAnswerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(DEVICE_AGENT_REQUEST_KIND.READ_FILE),
  bytes: EffectSchema.NullOr(
    EffectSchema.Uint8Array.check(
      EffectSchema.isMaxLength(DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
    ),
  ),
});

export type DeviceAgentAnswer = typeof deviceAgentAnswerSchema.Type;

export const DEVICE_AGENT_FOLDER = {
  ROOT: ".vespin/agents",
  REPOSITORY: "repository",
  ATTACHMENTS: "attachments",
  INSTALLED_SKILLS: "installed-skills",
  GITHUB_CONFIG: "gh",
  TEMP: "tmp",
} as const;

export interface DeviceAgentLayout {
  readonly folder: string;
  readonly checkoutPath: string;
  readonly attachments: string;
  readonly installedSkills: string;
  readonly githubConfig: string;
  readonly temp: string;
}

export function deviceAgentsFolder(home: string): string {
  let end = home.length;
  while (end > 1 && home[end - 1] === "/") end -= 1;
  return [home.slice(0, end), DEVICE_AGENT_FOLDER.ROOT].join("/");
}

export function deviceAgentLayout(home: string, agentId: string): DeviceAgentLayout {
  return deviceAgentLayoutIn(deviceAgentsFolder(home), agentId);
}

export function deviceAgentLayoutIn(agentsFolder: string, agentId: string): DeviceAgentLayout {
  const folder = [agentsFolder, agentId].join("/");
  return {
    folder,
    checkoutPath: [folder, DEVICE_AGENT_FOLDER.REPOSITORY].join("/"),
    attachments: [folder, DEVICE_AGENT_FOLDER.ATTACHMENTS].join("/"),
    installedSkills: [folder, DEVICE_AGENT_FOLDER.INSTALLED_SKILLS].join("/"),
    githubConfig: [folder, DEVICE_AGENT_FOLDER.GITHUB_CONFIG].join("/"),
    temp: [folder, DEVICE_AGENT_FOLDER.TEMP].join("/"),
  };
}

const macPath = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.makeFilter((path: string) => path.startsWith("/") || "an absolute path"),
);

export const deviceAgentLaunchPayloadSchema = EffectSchema.Struct({
  checkoutPath: macPath,
  repository: EffectSchema.NullOr(EffectSchema.String),
  startBranch: EffectSchema.NullOr(EffectSchema.String),
  firstSequence: EffectSchema.Int,
  fingerprint: EffectSchema.optionalKey(EffectSchema.String),
  identity: EffectSchema.optionalKey(checkoutIdentitySchema),
  githubAccess: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(DEVICE_GITHUB_ACCESS)),
  ),
});

export type DeviceAgentLaunchPayload = typeof deviceAgentLaunchPayloadSchema.Type;

export const deviceAgentStdinPayloadSchema = EffectSchema.Struct({ text: EffectSchema.String });

const deviceAgentFileSchema = EffectSchema.Struct({
  path: macPath,
  mode: EffectSchema.Int,
  contents: EffectSchema.Uint8ArrayFromBase64,
});

export const deviceAgentFilesPayloadSchema = EffectSchema.Struct({
  files: EffectSchema.Array(deviceAgentFileSchema),
});

export type DeviceAgentFilesPayload = typeof deviceAgentFilesPayloadSchema.Type;

export const deviceAgentLaunchSecretsSchema = EffectSchema.Struct({
  env: EffectSchema.Record(EffectSchema.String, EffectSchema.String),
  stdin: EffectSchema.String,
});

export type DeviceAgentLaunchSecrets = typeof deviceAgentLaunchSecretsSchema.Type;

const lineKind = EffectSchema.Union([
  EffectSchema.Literals(Object.values(DEVICE_AGENT_LINE_KIND)),
  EffectSchema.String,
]);

const requestKind = EffectSchema.Literals(Object.values(DEVICE_AGENT_REQUEST_KIND));

const deviceAgentLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  seq: EffectSchema.Int,
  kind: lineKind,
  payload: deviceAgentObjectSchema,
});

export type DeviceAgentLine = typeof deviceAgentLineSchema.Type;

const deviceAgentRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  kind: requestKind,
  args: deviceAgentObjectSchema,
});

export type DeviceAgentRequest = typeof deviceAgentRequestSchema.Type;

export const deviceAgentReadArgsSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  maxBytes: EffectSchema.Int,
});

const deviceField = { deviceId: wireUuidSchema };

export const deviceAgentRegisterRequestSchema = EffectSchema.Struct({
  ...deviceField,
  name: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(200)),
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
  ...deviceMachineFields,
  home: macPath,
  agentsFolder: EffectSchema.optionalKey(macPath),
  claudeExecutable: macPath,
  codexExecutable: EffectSchema.optionalKey(macPath),
  capabilities: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.Literals(Object.values(DEVICE_CAPABILITY))).check(
      EffectSchema.isMaxLength(16),
    ),
  ),
  setup: EffectSchema.optionalKey(deviceSetupSchema),
  setupFailure: EffectSchema.optionalKey(
    EffectSchema.String.check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(DEVICE_SETUP_FAILURE_MAX_CHARS),
    ),
  ),
});

export const deviceAgentDeviceRequestSchema = EffectSchema.Struct(deviceField);

export const deviceAgentBeatRequestSchema = EffectSchema.Struct({
  ...deviceField,
  update: EffectSchema.optionalKey(hostUpdateSchema),
  updateFailure: EffectSchema.optionalKey(
    EffectSchema.String.check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(HOST_UPDATE_FAILURE_MAX_CHARS),
    ),
  ),
});

export const deviceAgentClaimRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  claimToken: EffectSchema.optionalKey(wireUuidSchema),
});

export const deviceAgentSettleRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  exitCode: EffectSchema.optionalKey(EffectSchema.Int),
  unstarted: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(DEVICE_LAUNCH_UNSTARTED)),
  ),
});

export const deviceAgentStepRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  step: EffectSchema.Literals(DEVICE_LAUNCH_STEPS),
});

export const deviceAgentAnswerRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  answer: EffectSchema.Struct({
    kind: EffectSchema.Literal(DEVICE_AGENT_REQUEST_KIND.READ_FILE),
    bytes: EffectSchema.NullOr(
      EffectSchema.Uint8ArrayFromBase64.check(
        EffectSchema.isMaxLength(DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
      ),
    ),
  }),
});

export const deviceAgentDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});

const sha256HexSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{64}$/u));

export const deviceAgentReleaseSchema = EffectSchema.Struct({
  version: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(32)),
  sha256: EffectSchema.Struct({
    [HOST_TARGET.LINUX_X64]: sha256HexSchema,
    [HOST_TARGET.LINUX_ARM64]: sha256HexSchema,
    [HOST_TARGET.DARWIN_ARM64]: EffectSchema.optionalKey(sha256HexSchema),
  }),
});

export type DeviceAgentRelease = typeof deviceAgentReleaseSchema.Type;

export const deviceAgentBeatAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
  openLaunches: EffectSchema.Array(wireUuidSchema),
  release: EffectSchema.optionalKey(deviceAgentReleaseSchema),
});

export const deviceAgentLiveAgentsAnswerSchema = EffectSchema.Struct({
  agentIds: EffectSchema.Array(wireUuidSchema),
});

export const deviceAgentLinesAnswerSchema = EffectSchema.Struct({
  lines: EffectSchema.Array(deviceAgentLineSchema),
});

export const deviceAgentLineClaimAnswerSchema = EffectSchema.Struct({
  line: deviceAgentLineSchema,
  secrets: EffectSchema.optionalKey(deviceAgentLaunchSecretsSchema),
  secretsGone: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export const deviceAgentRequestsAnswerSchema = EffectSchema.Struct({
  requests: EffectSchema.Array(deviceAgentRequestSchema),
});

export const deviceAgentRequestClaimAnswerSchema = EffectSchema.Struct({
  request: deviceAgentRequestSchema,
});
