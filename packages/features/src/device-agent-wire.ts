import { Schema as EffectSchema } from "effect";
import { checkoutIdentitySchema } from "./checkout-identity.js";
import { HOST_TARGET } from "./host-release.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * device-agent-wire.ts -- the work the service hands a local agent's Mac, as rows the Mac follows, and what the Mac answers.
 *
 * A coding agent whose machine is the starter's Mac (`AGENT_MACHINE`)
 * runs its runner there rather than in a Vercel Sandbox. The service writes
 * the runner's lines (`DEVICE_AGENT_LINE_KIND`) and its tools' requests
 * (`DEVICE_AGENT_REQUEST_KIND`) as rows under the account and the Mac the agent
 * is pinned to (`packages/database/src/schemas/device-agent.ts`); the Mac
 * follows them, as it follows `run_on_mac`'s commands, claims each by its
 * id, and settles or answers it. It runs Claude Code or Codex, each
 * the binary the Mac registered.
 *
 * The Mac's side, under its sign-in token and never a cookie, naming its
 * device id on every call (`contract/device-agents.ts`): it registers on every
 * start, with its name, its home folder, and the Claude Code CLI it bundles,
 * so a new agent's paths follow the account and the CLI follows each app
 * update; it beats its presence while it runs local agents, which is what
 * offers This Mac at Start; it holds a read for its lines and one for its
 * requests, each answered as soon as one waits, claims each by its id, says
 * which step a launch it claimed has reached (`DEVICE_LAUNCH_STEP`), and
 * settles a line or answers a request. Claiming a launch line hands its
 * secrets over once (`deviceAgentLaunchSecretsSchema`): the service opens them
 * from the row's seal and clears the row's copy in the same claim.
 *
 * Every path the service hands out is absolute, under the agent's own
 * folder in the Mac's home (`deviceAgentLayout`): its worktree, the files a
 * message carries, and the skills its member installed into the app, never
 * the user's own `~/.claude`.
 */

export const DEVICE_AGENT_BOUNDS = {
  /**
   * The most bytes of one file a read answers: a sandbox door's own bound
   * (`SANDBOX_DOOR_MAX_BYTES`), past every bound a tool holds a file to.
   */
  MAX_ANSWER_BYTES: 8 * 1024 * 1024,
} as const;

/** What one line to a local runner is. */
export const DEVICE_AGENT_LINE_KIND = {
  /** Start the runner: its checkout, its environment, and its first lines, with the secrets it is launched under. */
  LAUNCH: "launch",
  /** A line written to the running runner's stdin, such as a developer's message. */
  MESSAGE: "message",
  /** Stop the runner, killing its process group. */
  STOP: "stop",
  /** Move the running runner to another model or effort. */
  RETUNE: "retune",
  /** Files written under the agent's folder, before a later line names them, whether or not a runner runs. */
  FILES: "files",
  /** Let the agent go: its runner stopped, and its folder, its worktree and everything it wrote there, removed from the device. */
  DISCARD: "discard",
} as const;

export type DeviceAgentLineKind =
  (typeof DEVICE_AGENT_LINE_KIND)[keyof typeof DEVICE_AGENT_LINE_KIND];

/**
 * Where a host's launch of a local agent stands, as the host reports it on
 * the launch line it claimed (`deviceAgentStepRequestSchema`), in the order
 * a launch passes them, which is the order a report moves the line's step
 * along and never back. The agent's transcript words what it waits on from
 * it until the harness's first event opens its turn, and a launch the host
 * settles unstarted fails its turn in words naming the last step it
 * reported. A step travels as one word of this set and never as free text,
 * so no path, command's output, or credential rides with it.
 */
export const DEVICE_LAUNCH_STEP = {
  /** The launch taken and the agent's GitHub token fetched. */
  PREPARING: "preparing",
  /** The agent's repository being made, where its folder holds none. */
  FETCHING: "fetching",
  /** The agent's folders and Git set up, then the runner, and the harness it runs, Claude Code or Codex, starting. */
  STARTING: "starting",
} as const;

export type DeviceLaunchStep = (typeof DEVICE_LAUNCH_STEP)[keyof typeof DEVICE_LAUNCH_STEP];

/** A launch's steps in the order a launch passes them. */
export const DEVICE_LAUNCH_STEPS: readonly DeviceLaunchStep[] = Object.values(DEVICE_LAUNCH_STEP);

/** What one of an agent's tools asks of its Mac. */
export const DEVICE_AGENT_REQUEST_KIND = {
  /** Read one file, confined to the agent's worktree and temp folder. */
  READ_FILE: "read_file",
} as const;

export type DeviceAgentRequestKind =
  (typeof DEVICE_AGENT_REQUEST_KIND)[keyof typeof DEVICE_AGENT_REQUEST_KIND];

/**
 * What a device's follower takes beyond the lines every follower has taken
 * since the first, which it says on its register, so the service queues a
 * device no line it would not know. A follower that predates a line kind
 * fails its whole held read on one, so a line kind added after the first
 * names the capability it needs (`DEVICE_AGENT_LINE_CAPABILITY`).
 */
export const DEVICE_CAPABILITY = {
  /** It takes a discard line (`DEVICE_AGENT_LINE_KIND.DISCARD`). */
  DISCARD: "discard",
} as const;

export type DeviceCapability = (typeof DEVICE_CAPABILITY)[keyof typeof DEVICE_CAPABILITY];

/** The capability a device must have registered to be queued a line of the kind, for each kind that needs one. */
export const DEVICE_AGENT_LINE_CAPABILITY: Partial<Record<DeviceAgentLineKind, DeviceCapability>> =
  {
    [DEVICE_AGENT_LINE_KIND.DISCARD]: DEVICE_CAPABILITY.DISCARD,
  };

/**
 * What program a device runs local agents through, as a task's Runs on and
 * the devices offered name it to clients that decode it: every device runs
 * the host program, so the service names each `HOST`, keeps no kind on the
 * device's row, and nothing on the client side draws from it.
 */
export const DEVICE_KIND = {
  /** The desktop app, on the Mac its member is signed in at; no device is named it any more. */
  DESKTOP: "desktop",
  /** The host program, which every device runs. */
  HOST: "host",
} as const;

export type DeviceKind = (typeof DEVICE_KIND)[keyof typeof DEVICE_KIND];

/**
 * Where a device stands in setting itself up to run agents, as it registers
 * while it is not ready to take one: a device fetching the pinned agent CLIs
 * the first time, or one whose fetch failed. A device registers with none once it is ready, as every device
 * from before the field does, and only a device with none takes an agent.
 */
export const DEVICE_SETUP = {
  /** It is still fetching what its agents run on. */
  PREPARING: "preparing",
  /** Its fetch failed, for the reason it registered beside it. */
  FAILED: "failed",
} as const;

export type DeviceSetup = (typeof DEVICE_SETUP)[keyof typeof DEVICE_SETUP];

export const deviceSetupSchema = EffectSchema.Literals(Object.values(DEVICE_SETUP));

/** The most characters of the words a device says its setup failed for. */
export const DEVICE_SETUP_FAILURE_MAX_CHARS = 200;

/**
 * Where a host stands in updating itself to the newer release a beat's
 * answer named (`deviceAgentBeatAnswerSchema`), as its beats say it: holding
 * the release, checked, until its agents finish, switching to it, or failed.
 * A host beats with none while no update is under way, as every host from
 * before the field does.
 */
export const HOST_UPDATE = {
  /** It holds the release, checked, and waits for its agents to finish before it switches. */
  WAITING: "waiting",
  /** It is switching to the release now. */
  UPDATING: "updating",
  /** Its update failed, for the reason it beat beside it. */
  FAILED: "failed",
} as const;

export type HostUpdate = (typeof HOST_UPDATE)[keyof typeof HOST_UPDATE];

export const hostUpdateSchema = EffectSchema.Literals(Object.values(HOST_UPDATE));

/** The most characters of the words a host says its update failed for. */
export const HOST_UPDATE_FAILURE_MAX_CHARS = 200;

/** A device's operating system, as Node's `process.platform` names it. */
export const DEVICE_PLATFORM = {
  DARWIN: "darwin",
  LINUX: "linux",
} as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM)[keyof typeof DEVICE_PLATFORM];

/** A device's CPU architecture, as Node's `process.arch` names it. */
export const DEVICE_ARCH = {
  ARM64: "arm64",
  X64: "x64",
} as const;

export type DeviceArch = (typeof DEVICE_ARCH)[keyof typeof DEVICE_ARCH];

/** The most characters of a machine's model as its host reports it. */
export const DEVICE_MODEL_MAX_CHARS = 200;

/**
 * Which machine a device runs on, as its host reports it at its own
 * enroll, its pairing's start, and every register: a keyed SHA-256 of the
 * OS's own id for the machine, in lower-case hex, never the id itself
 * (`@repo/host/node`'s `machine-identity.ts`), so every install on one
 * machine names the same one and two machines of one name differ; and on a
 * Mac its model as a person reads it ("MacBook Air (M2, 2022)"). Each is
 * absent where the host could not read it, and from a host older than it.
 * Note that the id is held to a digest's shape, so a host that sent the
 * OS's own id by mistake is refused rather than stored.
 */
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

/** A line's payload or a request's arguments: a JSON object whose shape its kind's reader holds. */
export const deviceAgentObjectSchema = EffectSchema.Record(
  EffectSchema.String,
  EffectSchema.Unknown,
);

export type DeviceAgentObject = typeof deviceAgentObjectSchema.Type;

/**
 * What the Mac answered a request: a read's file bytes, read one byte past
 * the bound so the caller still sees a file larger than it, or null where
 * the path names no regular file the agent may read.
 */
export const deviceAgentAnswerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(DEVICE_AGENT_REQUEST_KIND.READ_FILE),
  bytes: EffectSchema.NullOr(
    EffectSchema.Uint8Array.check(
      EffectSchema.isMaxLength(DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
    ),
  ),
});

export type DeviceAgentAnswer = typeof deviceAgentAnswerSchema.Type;

/** The folders under a Mac's home its local agents' things stand in (`deviceAgentLayout`). */
export const DEVICE_AGENT_FOLDER = {
  /** Every local agent's folder, one per agent under its id. */
  ROOT: ".vespin/agents",
  /** The agent's worktree, which the Mac makes as it takes the launch line. */
  REPOSITORY: "repository",
  /** The files a message carries, one folder per line, made `0700`. */
  ATTACHMENTS: "attachments",
  /** The skills the member installed into the app, as the harness's local plugin. */
  INSTALLED_SKILLS: "installed-skills",
  /** The agent's own `gh` sign-in on a host (`GH_CONFIG_DIR`), which no read of the agent's tools answers from. */
  GITHUB_CONFIG: "gh",
  /** The agent's temp folder (`TMPDIR`), made `0700`, which its runner and its commands write to, and where it saves what we read back. */
  TEMP: "tmp",
} as const;

/** Where a local agent's things stand on a Mac, every path absolute. */
export interface DeviceAgentLayout {
  readonly folder: string;
  readonly checkoutPath: string;
  readonly attachments: string;
  readonly installedSkills: string;
  readonly githubConfig: string;
  readonly temp: string;
}

/** The folder every local agent's folder stands in, under the Mac's home folder given, which its host registers (`agentsFolder`). */
export function deviceAgentsFolder(home: string): string {
  let end = home.length;
  // Note that the trailing slashes are counted off by hand, because a regular expression anchored at the end runs in quadratic time on a home of many slashes.
  while (end > 1 && home[end - 1] === "/") end -= 1;
  return [home.slice(0, end), DEVICE_AGENT_FOLDER.ROOT].join("/");
}

/** The agent's folder and what stands in it, under the Mac's home folder given. */
export function deviceAgentLayout(home: string, agentId: string): DeviceAgentLayout {
  return deviceAgentLayoutIn(deviceAgentsFolder(home), agentId);
}

/** The agent's folder and what stands in it, under the folder of the Mac's local agents given (`deviceAgentsFolder`). */
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

/** An absolute path on the Mac. */
const macPath = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.makeFilter((path: string) => path.startsWith("/") || "an absolute path"),
);

/**
 * A launch line's payload: where its worktree goes and what it checks out,
 * the repository as `owner/name` and the branch it starts from, none for an
 * agent with no repository or on the default branch, and who its commits
 * are by. Its environment and
 * its first lines are its secrets, handed over by the claim alone.
 */
export const deviceAgentLaunchPayloadSchema = EffectSchema.Struct({
  checkoutPath: macPath,
  repository: EffectSchema.NullOr(EffectSchema.String),
  startBranch: EffectSchema.NullOr(EffectSchema.String),
  /** The first event number of the launch, which the runner's config also carries. */
  firstSequence: EffectSchema.Int,
  /** What the launch was started with, as a one-way digest the service reads back; nothing for the Mac to read. */
  fingerprint: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * Who the agent's commits are by, as the service settled it for a cloud
   * checkout too, which the device sets in the agent's repository before the
   * runner starts (`checkout-identity.ts`); absent for an agent with no
   * repository, and from a service before the field, whose launch sets none.
   */
  identity: EffectSchema.optionalKey(checkoutIdentitySchema),
});

export type DeviceAgentLaunchPayload = typeof deviceAgentLaunchPayloadSchema.Type;

/** A message or retune line's payload: the text written to the runner's stdin as it stands, newlines and all. */
export const deviceAgentStdinPayloadSchema = EffectSchema.Struct({ text: EffectSchema.String });

/** One file a files line writes: its absolute path under the agent's folder, its mode, and its bytes in base64. */
const deviceAgentFileSchema = EffectSchema.Struct({
  path: macPath,
  mode: EffectSchema.Int,
  contents: EffectSchema.Uint8ArrayFromBase64,
});

/** A files line's payload. */
export const deviceAgentFilesPayloadSchema = EffectSchema.Struct({
  files: EffectSchema.Array(deviceAgentFileSchema),
});

export type DeviceAgentFilesPayload = typeof deviceAgentFilesPayloadSchema.Type;

/**
 * A launch's secrets, as the claim of its line hands them over once: the
 * runner's environment, every value secret (its bearer and its harness's
 * credential), set on the runner's process alone and never written to a
 * file, an argument, or a log; its first lines, written to its stdin
 * before anything else.
 */
export const deviceAgentLaunchSecretsSchema = EffectSchema.Struct({
  env: EffectSchema.Record(EffectSchema.String, EffectSchema.String),
  stdin: EffectSchema.String,
});

export type DeviceAgentLaunchSecrets = typeof deviceAgentLaunchSecretsSchema.Type;

/**
 * A line's kind as the device reads it: one of `DEVICE_AGENT_LINE_KIND`, or
 * a kind a newer service added, which the follower settles without acting
 * on, so one line it does not know never fails the read of every line after.
 */
const lineKind = EffectSchema.Union([
  EffectSchema.Literals(Object.values(DEVICE_AGENT_LINE_KIND)),
  EffectSchema.String,
]);

const requestKind = EffectSchema.Literals(Object.values(DEVICE_AGENT_REQUEST_KIND));

/** One line as the Mac lists it: its id, its agent, its place in the order, its kind, and its payload, which its kind's schema reads. */
const deviceAgentLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  seq: EffectSchema.Int,
  kind: lineKind,
  payload: deviceAgentObjectSchema,
});

export type DeviceAgentLine = typeof deviceAgentLineSchema.Type;

/** One request as the Mac lists and claims it: its id, its agent, its kind, and its arguments (`deviceAgentReadArgsSchema`). */
const deviceAgentRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  kind: requestKind,
  args: deviceAgentObjectSchema,
});

export type DeviceAgentRequest = typeof deviceAgentRequestSchema.Type;

/** A read request's arguments: the absolute path, and how many bytes to read at most. */
export const deviceAgentReadArgsSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  maxBytes: EffectSchema.Int,
});

/** The device a call names, by the id it enrolled under. */
const deviceField = { deviceId: wireUuidSchema };

/**
 * A register: the Mac's id, its name, its home folder, and the CLI it
 * bundles, both absolute, the Codex binary it runs, absent until it has one,
 * its platform and architecture, and the capabilities its follower has
 * (`DEVICE_CAPABILITY`), absent for none. The device sends each key only when it names something
 * beyond the default, so a service from before it, which refuses a key it
 * does not know, never sees it from a device that has none. A device names each executable
 * by its path where its agents run: the CLIs it keeps on the device. A device not
 * ready to take an agent yet registers where its setup stands
 * (`DEVICE_SETUP`), and for one that failed, in words of its own naming no
 * secret, why; it names none once ready, so a service from before the
 * field, which refuses it, only misses a device it would never have listed.
 * It names the machine it runs on where it read it (`deviceMachineFields`).
 * It names the folder its own layout puts its agents under
 * (`deviceAgentsFolder`), absolute, so a launch is laid out where the device
 * looks for it whichever build moved `DEVICE_AGENT_FOLDER.ROOT`; a device
 * from before the field names none, and its agents are laid out under its
 * home as this build's root puts them. Note that a device names it on every
 * register, default or not, because only the device knows its own root; so
 * a host build with it ships only after every service takes it.
 */
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

/** A held read of lines or requests: the device alone. */
export const deviceAgentDeviceRequestSchema = EffectSchema.Struct(deviceField);

/**
 * A beat: the device, and where its update stands (`HOST_UPDATE`), with why
 * for one that failed, while one is under way. A beat naming no update clears the
 * last one; a host sends the key only while it names one, so a service from
 * before the field, which refuses it, never sees it from a host updating
 * nothing.
 */
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

/** One line or request claimed by its id. */
export const deviceAgentClaimRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  /**
   * The token the Mac minted for a line's claim and carries on every retry
   * of it, so a claim whose answer was lost is answered again rather than
   * refused as taken; absent from a build before the field, whose claim is
   * taken once, and from a request's claim.
   */
  claimToken: EffectSchema.optionalKey(wireUuidSchema),
});

/** A line settled: its id, and for a launch line whose runner exited, its exit code. */
export const deviceAgentSettleRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  exitCode: EffectSchema.optionalKey(EffectSchema.Int),
});

/**
 * A launch line's step reported: its id, and where the host's launch of it
 * stands now (`DEVICE_LAUNCH_STEP`). The service keeps it only on a launch
 * line of the device's it claimed and has not settled, and only where it
 * moves the line's step forward, so a report that lands late never takes it
 * back.
 */
export const deviceAgentStepRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  step: EffectSchema.Literals(DEVICE_LAUNCH_STEPS),
});

/** A request answered: its id, and the answer of its kind, a read's bytes in base64. */
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

/** That the service kept what the Mac said. */
export const deviceAgentDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});

/** A tarball's SHA-256, in lower-case hex. */
const sha256HexSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{64}$/u));

/**
 * A release of the host program, as a beat's answer names it (`HostRelease`):
 * its version, and each target's tarball by its SHA-256 in hex, a Mac's
 * absent from a release with no Mac package. No address rides with it,
 * since the host builds each from the version (`hostTarballUrl`), so no
 * answer can send a host to download from elsewhere.
 */
export const deviceAgentReleaseSchema = EffectSchema.Struct({
  version: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(32)),
  sha256: EffectSchema.Struct({
    [HOST_TARGET.LINUX_X64]: sha256HexSchema,
    [HOST_TARGET.LINUX_ARM64]: sha256HexSchema,
    [HOST_TARGET.DARWIN_ARM64]: EffectSchema.optionalKey(sha256HexSchema),
  }),
});

export type DeviceAgentRelease = typeof deviceAgentReleaseSchema.Type;

/**
 * That the service took a beat, and the launches it holds the device to:
 * the ids of its launch lines still unsettled with no stop queued after
 * them, claimed or not, read after the beat was written. The device stops a
 * runner whose launch it does not name and settles a named launch it runs
 * nothing for; a service from before the field names none, and a build from
 * before it ignores it. Where the service publishes a release newer than
 * the version the host called with (`HOST_WIRE.VERSION_HEADER`), it names
 * that release, which a host updates itself to; a host on it or past it is
 * named none, and a build from before the field drops it unread.
 */
export const deviceAgentBeatAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
  openLaunches: EffectSchema.optionalKey(EffectSchema.Array(wireUuidSchema)),
  release: EffectSchema.optionalKey(deviceAgentReleaseSchema),
});

/**
 * The ids of the account's agents that should still stand on this Mac:
 * those pinned to it and not archived, whatever their task's status. A
 * device removes the folder of any agent of ours it holds that is
 * not named, so the list is what stands rather than a discard it could miss.
 */
export const deviceAgentLiveAgentsAnswerSchema = EffectSchema.Struct({
  agentIds: EffectSchema.Array(wireUuidSchema),
});

/** The lines waiting for this Mac, in their order, none where none came while the read was held; nothing claimed. */
export const deviceAgentLinesAnswerSchema = EffectSchema.Struct({
  lines: EffectSchema.Array(deviceAgentLineSchema),
});

/**
 * A line claimed for this Mac, with a launch line's secrets, opened once;
 * `not-found` where another claim took it, it was settled, or it was
 * withdrawn. A claim asked again under its token is answered the line
 * again, and a launch line as `secretsGone`, since its first claim took
 * them.
 */
export const deviceAgentLineClaimAnswerSchema = EffectSchema.Struct({
  line: deviceAgentLineSchema,
  secrets: EffectSchema.optionalKey(deviceAgentLaunchSecretsSchema),
  secretsGone: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

/** The requests waiting for this Mac, oldest first, none where none came while the read was held; nothing claimed. */
export const deviceAgentRequestsAnswerSchema = EffectSchema.Struct({
  requests: EffectSchema.Array(deviceAgentRequestSchema),
});

/** A request claimed for this Mac; `not-found` where another claim took it or its caller withdrew it. */
export const deviceAgentRequestClaimAnswerSchema = EffectSchema.Struct({
  request: deviceAgentRequestSchema,
});
