import { Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";

/**
 * mac-agent-wire.ts -- the work the service hands a local agent's Mac, as rows the Mac follows, and what the Mac answers.
 *
 * A coding agent whose machine is the starter's Mac (`CODING_AGENT_MACHINE`)
 * runs its runner there rather than in a Vercel Sandbox. The service writes
 * the runner's lines (`MAC_AGENT_LINE_KIND`) and its tools' requests
 * (`MAC_AGENT_REQUEST_KIND`) as rows under the account and the Mac the agent
 * is pinned to (`packages/database/src/schemas/mac-agent.ts`); the Mac
 * follows them, as it follows `run_on_mac`'s commands, claims each by its
 * id, and settles or answers it. It runs Claude Code or Codex, each
 * the binary the Mac registered.
 *
 * The Mac's side, under its sign-in token and never a cookie, naming its
 * device id on every call (`contract/mac-agents.ts`): it registers on every
 * start, with its name, its home folder, and the Claude Code CLI it bundles,
 * so a new agent's paths follow the account and the CLI follows each app
 * update; it beats its presence while it runs local agents, which is what
 * offers This Mac at Start; it holds a read for its lines and one for its
 * requests, each answered as soon as one waits, claims each by its id, and
 * settles a line or answers a request. Its register and its beats say which
 * harnesses the Mac is signed in to itself (`macSignedInSchema`), which a
 * local agent's launch prefers to the account's saved credential. Claiming a launch line hands its
 * secrets over once (`macAgentLaunchSecretsSchema`): the service opens them
 * from the row's seal and clears the row's copy in the same claim. Every
 * call answers nothing to an account with the `local-agents` experiment off.
 *
 * Every path the service hands out is absolute, under the agent's own
 * folder in the Mac's home (`macAgentLayout`): its worktree, the files a
 * message carries, and the skills its member installed into Luke, never
 * the user's own `~/.claude`.
 */

export const MAC_AGENT_BOUNDS = {
  /**
   * The most bytes of one file a read answers, and of each of a command's
   * outputs: a sandbox door's own bound (`SANDBOX_DOOR_MAX_BYTES`), past
   * every bound a tool holds a file to.
   */
  MAX_ANSWER_BYTES: 8 * 1024 * 1024,
} as const;

/** What one line to a local runner is. */
export const MAC_AGENT_LINE_KIND = {
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
} as const;

export type MacAgentLineKind = (typeof MAC_AGENT_LINE_KIND)[keyof typeof MAC_AGENT_LINE_KIND];

/** What one of an agent's tools asks of its Mac. */
export const MAC_AGENT_REQUEST_KIND = {
  /** Read one file, confined to the agent's worktree and temp folder. */
  READ_FILE: "read_file",
  /** Run one command in the agent's checkout and wait on it, as `show_code` does. */
  RUN_COMMAND: "run_command",
} as const;

export type MacAgentRequestKind =
  (typeof MAC_AGENT_REQUEST_KIND)[keyof typeof MAC_AGENT_REQUEST_KIND];

/** A line's payload or a request's arguments: a JSON object whose shape its kind's reader holds. */
export const macAgentObjectSchema = EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown);

export type MacAgentObject = typeof macAgentObjectSchema.Type;

/** A command's output, held to the bound in UTF-8 bytes rather than characters, since a character may take up to four. */
const commandOutput = EffectSchema.String.check(
  EffectSchema.makeFilter(
    (value: string) =>
      Buffer.byteLength(value, "utf8") <= MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES ||
      `at most ${MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES} bytes`,
  ),
);

/**
 * What the Mac answered a request. A read answers the file's bytes, read
 * one byte past the bound so the caller still sees a file larger than it,
 * or null where the path names no regular file the agent may read; a
 * command answers its exit code and its two outputs, each cut to the bound.
 */
export const macAgentAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MAC_AGENT_REQUEST_KIND.READ_FILE),
    bytes: EffectSchema.NullOr(
      EffectSchema.Uint8Array.check(
        EffectSchema.isMaxLength(MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
      ),
    ),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(MAC_AGENT_REQUEST_KIND.RUN_COMMAND),
    exitCode: EffectSchema.Int,
    stdout: commandOutput,
    stderr: commandOutput,
  }),
]);

export type MacAgentAnswer = typeof macAgentAnswerSchema.Type;

/** The folders under a Mac's home its local agents' things stand in (`macAgentLayout`). */
export const MAC_AGENT_FOLDER = {
  /** Every local agent's folder, one per agent under its id. */
  ROOT: ".luke/agents",
  /** The agent's worktree, which the Mac makes as it takes the launch line. */
  REPOSITORY: "repository",
  /** The files a message carries, one folder per line, made `0700`. */
  ATTACHMENTS: "attachments",
  /** The skills the member installed into Luke, as the harness's local plugin. */
  INSTALLED_SKILLS: "installed-skills",
} as const;

/** Where a local agent's things stand on a Mac, every path absolute. */
export interface MacAgentLayout {
  readonly folder: string;
  readonly checkoutPath: string;
  readonly attachments: string;
  readonly installedSkills: string;
}

/** The agent's folder and what stands in it, under the Mac's home folder given. */
export function macAgentLayout(home: string, agentId: string): MacAgentLayout {
  let end = home.length;
  // Note that the trailing slashes are counted off by hand, because a regular expression anchored at the end runs in quadratic time on a home of many slashes.
  while (end > 1 && home[end - 1] === "/") end -= 1;
  const folder = [home.slice(0, end), MAC_AGENT_FOLDER.ROOT, agentId].join("/");
  return {
    folder,
    checkoutPath: [folder, MAC_AGENT_FOLDER.REPOSITORY].join("/"),
    attachments: [folder, MAC_AGENT_FOLDER.ATTACHMENTS].join("/"),
    installedSkills: [folder, MAC_AGENT_FOLDER.INSTALLED_SKILLS].join("/"),
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
 * agent with no repository or on the default branch. Its environment and
 * its first lines are its secrets, handed over by the claim alone.
 */
export const macAgentLaunchPayloadSchema = EffectSchema.Struct({
  checkoutPath: macPath,
  repository: EffectSchema.NullOr(EffectSchema.String),
  startBranch: EffectSchema.NullOr(EffectSchema.String),
  /** The first event number of the launch, which the runner's config also carries. */
  firstSequence: EffectSchema.Int,
  /** What the launch was started with, as a one-way digest the service reads back; nothing for the Mac to read. */
  fingerprint: EffectSchema.optionalKey(EffectSchema.String),
});

export type MacAgentLaunchPayload = typeof macAgentLaunchPayloadSchema.Type;

/** A message or retune line's payload: the text written to the runner's stdin as it stands, newlines and all. */
export const macAgentStdinPayloadSchema = EffectSchema.Struct({ text: EffectSchema.String });

/** One file a files line writes: its absolute path under the agent's folder, its mode, and its bytes in base64. */
const macAgentFileSchema = EffectSchema.Struct({
  path: macPath,
  mode: EffectSchema.Int,
  contents: EffectSchema.Uint8ArrayFromBase64,
});

/** A files line's payload. */
export const macAgentFilesPayloadSchema = EffectSchema.Struct({
  files: EffectSchema.Array(macAgentFileSchema),
});

export type MacAgentFilesPayload = typeof macAgentFilesPayloadSchema.Type;

/**
 * A launch's secrets, as the claim of its line hands them over once: the
 * runner's environment, every value secret (its bearer and its harness's
 * credential), set on the runner's process alone and never written to a
 * file, an argument, or a log; and its first lines, written to its stdin
 * before anything else.
 */
export const macAgentLaunchSecretsSchema = EffectSchema.Struct({
  env: EffectSchema.Record(EffectSchema.String, EffectSchema.String),
  stdin: EffectSchema.String,
});

export type MacAgentLaunchSecrets = typeof macAgentLaunchSecretsSchema.Type;

const lineKind = EffectSchema.Literals(Object.values(MAC_AGENT_LINE_KIND));

const requestKind = EffectSchema.Literals(Object.values(MAC_AGENT_REQUEST_KIND));

/** One line as the Mac lists it: its id, its agent, its place in the order, its kind, and its payload, which its kind's schema reads. */
const macAgentLineSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  seq: EffectSchema.Int,
  kind: lineKind,
  payload: macAgentObjectSchema,
});

export type MacAgentLine = typeof macAgentLineSchema.Type;

/** One request as the Mac lists and claims it: its id, its agent, its kind, and its arguments (`macAgentReadArgsSchema`, `macAgentCommandArgsSchema`). */
const macAgentRequestSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  kind: requestKind,
  args: macAgentObjectSchema,
});

export type MacAgentRequest = typeof macAgentRequestSchema.Type;

/** A read request's arguments: the absolute path, and how many bytes to read at most. */
export const macAgentReadArgsSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  maxBytes: EffectSchema.Int,
});

/** A command request's arguments: the shell script, run by bash in the agent's worktree, and its environment beside the Mac's own. */
export const macAgentCommandArgsSchema = EffectSchema.Struct({
  command: EffectSchema.String,
  env: EffectSchema.optionalKey(EffectSchema.Record(EffectSchema.String, EffectSchema.String)),
});

/**
 * Which harnesses the Mac is signed in to by itself, by the harness's own
 * login on the Mac, never the credential: a local agent on a harness its Mac
 * is signed in to launches on that login rather than the plan or key the
 * account saved in Luke. A key absent is a harness the Mac did not check.
 */
export const macSignedInSchema = EffectSchema.Struct({
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

export type MacSignedIn = typeof macSignedInSchema.Type;

/** The device a call names, by the id the desktop minted once. */
const deviceField = { deviceId: wireUuidSchema };

/**
 * A register: the Mac's id, its name, its home folder, and the CLI it
 * bundles, both absolute, the Codex binary it checked against the pin
 * (`@luke/agent-runner/pins`' `CODEX_MAC_PIN`), absent until it has one, and
 * which harnesses it is signed in to.
 */
export const macAgentRegisterRequestSchema = EffectSchema.Struct({
  ...deviceField,
  name: EffectSchema.String.check(EffectSchema.isMinLength(1), EffectSchema.isMaxLength(200)),
  home: macPath,
  claudeExecutable: macPath,
  codexExecutable: EffectSchema.optionalKey(macPath),
  signedIn: EffectSchema.optionalKey(macSignedInSchema),
});

/** A held read of lines or requests: the device alone. */
export const macAgentDeviceRequestSchema = EffectSchema.Struct(deviceField);

/** A beat: the device, and which harnesses it is signed in to now, where it checked. */
export const macAgentBeatRequestSchema = EffectSchema.Struct({
  ...deviceField,
  signedIn: EffectSchema.optionalKey(macSignedInSchema),
});

/** One line or request claimed by its id. */
export const macAgentClaimRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
});

/** A line settled: its id, and for a launch line whose runner exited, its exit code. */
export const macAgentSettleRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  exitCode: EffectSchema.optionalKey(EffectSchema.Int),
});

/** A request answered: its id, and the answer of its kind, a read's bytes in base64. */
export const macAgentAnswerRequestSchema = EffectSchema.Struct({
  ...deviceField,
  id: wireUuidSchema,
  answer: EffectSchema.Union([
    EffectSchema.Struct({
      kind: EffectSchema.Literal(MAC_AGENT_REQUEST_KIND.READ_FILE),
      bytes: EffectSchema.NullOr(
        EffectSchema.Uint8ArrayFromBase64.check(
          EffectSchema.isMaxLength(MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
        ),
      ),
    }),
    EffectSchema.Struct({
      kind: EffectSchema.Literal(MAC_AGENT_REQUEST_KIND.RUN_COMMAND),
      exitCode: EffectSchema.Int,
      stdout: commandOutput,
      stderr: commandOutput,
    }),
  ]),
});

/** That the service kept what the Mac said. */
export const macAgentDoneAnswerSchema = EffectSchema.Struct({ done: EffectSchema.Literal(true) });

/** The lines waiting for this Mac, in their order, none where none came while the read was held; nothing claimed. */
export const macAgentLinesAnswerSchema = EffectSchema.Struct({
  lines: EffectSchema.Array(macAgentLineSchema),
});

/** A line claimed for this Mac, with a launch line's secrets, opened once; `not-found` where another claim took it or it was withdrawn. */
export const macAgentLineClaimAnswerSchema = EffectSchema.Struct({
  line: macAgentLineSchema,
  secrets: EffectSchema.optionalKey(macAgentLaunchSecretsSchema),
});

/** The requests waiting for this Mac, oldest first, none where none came while the read was held; nothing claimed. */
export const macAgentRequestsAnswerSchema = EffectSchema.Struct({
  requests: EffectSchema.Array(macAgentRequestSchema),
});

/** A request claimed for this Mac; `not-found` where another claim took it or its caller withdrew it. */
export const macAgentRequestClaimAnswerSchema = EffectSchema.Struct({
  request: macAgentRequestSchema,
});
