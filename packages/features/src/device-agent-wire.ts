import { Schema as EffectSchema } from "effect";
import { checkoutIdentitySchema } from "./checkout-identity.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * device-agent-wire.ts -- the work the service hands a local agent's Mac, as rows the Mac follows, and what the Mac answers.
 *
 * A coding agent whose machine is the starter's Mac (`CODING_AGENT_MACHINE`)
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
 * requests, each answered as soon as one waits, claims each by its id, and
 * settles a line or answers a request. Its register and its beats say which
 * harnesses the Mac is signed in to itself (`deviceSignedInSchema`), which a
 * local agent's launch prefers to the account's saved credential. Claiming a launch line hands its
 * secrets over once (`deviceAgentLaunchSecretsSchema`): the service opens them
 * from the row's seal and clears the row's copy in the same claim. Every
 * call answers nothing to an account with the `local-agents` experiment off.
 *
 * Every path the service hands out is absolute, under the agent's own
 * folder in the Mac's home (`deviceAgentLayout`): its worktree, the files a
 * message carries, and the skills its member installed into Luke, never
 * the user's own `~/.claude`.
 */

export const DEVICE_AGENT_BOUNDS = {
  /**
   * The most bytes of one file a read answers, and of each of a command's
   * outputs: a sandbox door's own bound (`SANDBOX_DOOR_MAX_BYTES`), past
   * every bound a tool holds a file to.
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

/** What one of an agent's tools asks of its Mac. */
export const DEVICE_AGENT_REQUEST_KIND = {
  /** Read one file, confined to the agent's worktree and temp folder. */
  READ_FILE: "read_file",
  /** Run one command in the agent's checkout and wait on it, as `show_code` does. */
  RUN_COMMAND: "run_command",
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

/** What program a device runs local agents through. */
export const DEVICE_KIND = {
  /** The Luke desktop app, on the Mac its member is signed in at. */
  DESKTOP: "desktop",
  /** A headless host a member added, with nobody signed in at it. */
  HOST: "host",
} as const;

export type DeviceKind = (typeof DEVICE_KIND)[keyof typeof DEVICE_KIND];

/**
 * How a device runs its local agents. A sandboxed agent runs in a Linux
 * microVM of its own, booted from Luke's sandbox image, with its folder
 * mounted in at the same absolute path it has on the device, so every path
 * the service hands out (`deviceAgentLayout`) stands in both modes; it
 * reaches none of the device's own tools, services, or logins.
 */
export const DEVICE_ISOLATION = {
  /** Each agent in a microVM of its own. */
  SANDBOX: "sandbox",
  /** Each agent directly on the device, with its installed tools and its own logins. */
  BARE: "bare",
} as const;

export type DeviceIsolation = (typeof DEVICE_ISOLATION)[keyof typeof DEVICE_ISOLATION];

/**
 * Where a device stands in setting itself up to run agents, as it registers
 * while it is not ready to take one: a Mac fetching its pinned smolvm and
 * pulling the sandbox image the first time, or one whose fetch or pull
 * failed. A device registers with none once it is ready, as every device
 * from before the field does, and only a device with none takes an agent.
 */
export const DEVICE_SETUP = {
  /** It is still fetching what its VMs run on. */
  PREPARING: "preparing",
  /** Its fetch failed, for the reason it registered beside it. */
  FAILED: "failed",
} as const;

export type DeviceSetup = (typeof DEVICE_SETUP)[keyof typeof DEVICE_SETUP];

export const deviceSetupSchema = EffectSchema.Literals(Object.values(DEVICE_SETUP));

/** The most characters of the words a device says its setup failed for. */
export const DEVICE_SETUP_FAILURE_MAX_CHARS = 200;

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

/** A line's payload or a request's arguments: a JSON object whose shape its kind's reader holds. */
export const deviceAgentObjectSchema = EffectSchema.Record(
  EffectSchema.String,
  EffectSchema.Unknown,
);

export type DeviceAgentObject = typeof deviceAgentObjectSchema.Type;

/** A command's output, held to the bound in UTF-8 bytes rather than characters, since a character may take up to four. */
const commandOutput = EffectSchema.String.check(
  EffectSchema.makeFilter(
    (value: string) =>
      Buffer.byteLength(value, "utf8") <= DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES ||
      `at most ${DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES} bytes`,
  ),
);

/**
 * What the Mac answered a request. A read answers the file's bytes, read
 * one byte past the bound so the caller still sees a file larger than it,
 * or null where the path names no regular file the agent may read; a
 * command answers its exit code and its two outputs, each cut to the bound.
 */
export const deviceAgentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(DEVICE_AGENT_REQUEST_KIND.READ_FILE),
    bytes: EffectSchema.NullOr(
      EffectSchema.Uint8Array.check(
        EffectSchema.isMaxLength(DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
      ),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(DEVICE_AGENT_REQUEST_KIND.RUN_COMMAND),
    exitCode: EffectSchema.Int,
    stdout: commandOutput,
    stderr: commandOutput,
  }),
]);

export type DeviceAgentAnswer = typeof deviceAgentAnswerSchema.Type;

/** The folders under a Mac's home its local agents' things stand in (`deviceAgentLayout`). */
export const DEVICE_AGENT_FOLDER = {
  /** Every local agent's folder, one per agent under its id. */
  ROOT: ".luke/agents",
  /** The agent's worktree, which the Mac makes as it takes the launch line. */
  REPOSITORY: "repository",
  /** The files a message carries, one folder per line, made `0700`. */
  ATTACHMENTS: "attachments",
  /** The skills the member installed into Luke, as the harness's local plugin. */
  INSTALLED_SKILLS: "installed-skills",
  /** The agent's own `gh` sign-in on a host (`GH_CONFIG_DIR`), which no read of the agent's tools answers from. */
  GITHUB_CONFIG: "gh",
  /** The agent's temp folder (`TMPDIR`), made `0700`, which its runner and its commands write to, and where it saves what Luke reads back. */
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

/** The agent's folder and what stands in it, under the Mac's home folder given. */
export function deviceAgentLayout(home: string, agentId: string): DeviceAgentLayout {
  let end = home.length;
  // Note that the trailing slashes are counted off by hand, because a regular expression anchored at the end runs in quadratic time on a home of many slashes.
  while (end > 1 && home[end - 1] === "/") end -= 1;
  const folder = [home.slice(0, end), DEVICE_AGENT_FOLDER.ROOT, agentId].join("/");
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
  /** Whether the launch runs on the Mac's own sign-in, which the service's token route reads back; absent for one on the account's credential. */
  ownLogin: EffectSchema.optionalKey(EffectSchema.Boolean),
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
 * file, an argument, or a log; and its first lines, written to its stdin
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

/** One request as the Mac lists and claims it: its id, its agent, its kind, and its arguments (`deviceAgentReadArgsSchema`, `deviceAgentCommandArgsSchema`). */
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

/** A command request's arguments: the shell script, run by bash in the agent's worktree, and its environment beside the Mac's own. */
export const deviceAgentCommandArgsSchema = EffectSchema.Struct({
  command: EffectSchema.String,
  env: EffectSchema.optionalKey(EffectSchema.Record(EffectSchema.String, EffectSchema.String)),
});

/**
 * Which harnesses the Mac is signed in to by itself, by the harness's own
 * login on the Mac, never the credential: a local agent on a harness its Mac
 * is signed in to launches on that login rather than the plan or key the
 * account saved in Luke. A key absent is a harness the Mac did not check.
 * A sandboxed device says none, since its agents cannot reach its logins,
 * so each launches on the account's saved credential.
 */
export const deviceSignedInSchema = EffectSchema.Struct({
  /** Claude Code's own login on the Mac, as `claude auth status` answers it for the CLI the Mac bundles. */
  claudeCode: EffectSchema.optionalKey(EffectSchema.Boolean),
  /**
   * Codex's own sign-in on the Mac, a managed ChatGPT login or an API key
   * `codex login` stored under the user's default `CODEX_HOME`, as
   * app-server's `account/read` answers it for the Codex the Mac checked
   * (https://learn.chatgpt.com/docs/app-server).
   */
  codex: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type DeviceSignedIn = typeof deviceSignedInSchema.Type;

/** The device a call names, by the id the desktop minted once. */
const deviceField = { deviceId: wireUuidSchema };

/**
 * A register: the Mac's id, its name, its home folder, and the CLI it
 * bundles, both absolute, the Codex binary it runs, absent until it has one,
 * which harnesses it is signed in to (neither, from a device that
 * runs its agents in VMs, on the sign-ins saved in Luke), its platform and architecture, and
 * how it runs its agents, absent for one that runs them bare, as every
 * desktop from before the field does, and the capabilities its follower has
 * (`DEVICE_CAPABILITY`), absent for none, as every desktop from before the
 * field registers. The device sends each key only when it names something
 * beyond the default, so a service from before it, which refuses a key it
 * does not know, never sees it from a device that has none; a capability
 * this service does not know is passed over rather than refused, so a newer
 * device's list never fails its register. A sandboxed device names each
 * executable by its path where its agents run, inside the VM. A device not
 * ready to take an agent yet registers where its setup stands
 * (`DEVICE_SETUP`), and for one that failed, in words of its own naming no
 * secret, why; it names none once ready, so a service from before the
 * field, which refuses it, only misses a device it would never have listed.
 */
export const deviceAgentRegisterRequestSchema = EffectSchema.Struct({
  ...deviceField,
  name: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(200)),
  platform: EffectSchema.Literals(Object.values(DEVICE_PLATFORM)),
  arch: EffectSchema.Literals(Object.values(DEVICE_ARCH)),
  isolation: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(DEVICE_ISOLATION))),
  home: macPath,
  claudeExecutable: macPath,
  codexExecutable: EffectSchema.optionalKey(macPath),
  signedIn: EffectSchema.optionalKey(deviceSignedInSchema),
  capabilities: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.String.check(EffectSchema.isMaxLength(64))).check(
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

/** A beat: the device, and which harnesses it is signed in to now, where it checked. */
export const deviceAgentBeatRequestSchema = EffectSchema.Struct({
  ...deviceField,
  signedIn: EffectSchema.optionalKey(deviceSignedInSchema),
});

/** One line or request claimed by its id. */
export const deviceAgentClaimRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
});

/** A line settled: its id, and for a launch line whose runner exited, its exit code. */
/**
 * Why a device settled a launch without starting its runner, where it is
 * one the service words for the agent's reader: the agent ran directly on
 * the device before, which now runs every agent in a VM, so its session
 * cannot be reached again there.
 */
export const DEVICE_LAUNCH_REFUSAL = {
  RAN_DIRECTLY: "ran-directly",
} as const;

export type DeviceLaunchRefusal =
  (typeof DEVICE_LAUNCH_REFUSAL)[keyof typeof DEVICE_LAUNCH_REFUSAL];

export const deviceAgentSettleRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  exitCode: EffectSchema.optionalKey(EffectSchema.Int),
  /** Why a launch was settled unstarted, where the device names why; a device from before it names none. */
  refusal: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(DEVICE_LAUNCH_REFUSAL))),
});

/** A request answered: its id, and the answer of its kind, a read's bytes in base64. */
export const deviceAgentAnswerRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  answer: EffectSchema.Union([
    EffectSchema.Struct({
      kind: EffectSchema.Literal(DEVICE_AGENT_REQUEST_KIND.READ_FILE),
      bytes: EffectSchema.NullOr(
        EffectSchema.Uint8ArrayFromBase64.check(
          EffectSchema.isMaxLength(DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
        ),
      ),
    }),
    EffectSchema.Struct({
      kind: EffectSchema.Literal(DEVICE_AGENT_REQUEST_KIND.RUN_COMMAND),
      exitCode: EffectSchema.Int,
      stdout: commandOutput,
      stderr: commandOutput,
    }),
  ]),
});

/** That the service kept what the Mac said. */
export const deviceAgentDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});

/** The lines waiting for this Mac, in their order, none where none came while the read was held; nothing claimed. */
export const deviceAgentLinesAnswerSchema = EffectSchema.Struct({
  lines: EffectSchema.Array(deviceAgentLineSchema),
});

/** A line claimed for this Mac, with a launch line's secrets, opened once; `not-found` where another claim took it or it was withdrawn. */
export const deviceAgentLineClaimAnswerSchema = EffectSchema.Struct({
  line: deviceAgentLineSchema,
  secrets: EffectSchema.optionalKey(deviceAgentLaunchSecretsSchema),
});

/** The requests waiting for this Mac, oldest first, none where none came while the read was held; nothing claimed. */
export const deviceAgentRequestsAnswerSchema = EffectSchema.Struct({
  requests: EffectSchema.Array(deviceAgentRequestSchema),
});

/** A request claimed for this Mac; `not-found` where another claim took it or its caller withdrew it. */
export const deviceAgentRequestClaimAnswerSchema = EffectSchema.Struct({
  request: deviceAgentRequestSchema,
});
