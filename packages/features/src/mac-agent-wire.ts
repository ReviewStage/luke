import { Schema as EffectSchema } from "effect";

/**
 * mac-agent-wire.ts -- the work the service hands a local agent's Mac, as rows the Mac follows, and what the Mac answers.
 *
 * A coding agent whose machine is the starter's Mac (`CODING_AGENT_MACHINE`)
 * runs its runner there rather than in a Vercel Sandbox. The service writes
 * the runner's lines (`MAC_AGENT_LINE_KIND`) and its tools' requests
 * (`MAC_AGENT_REQUEST_KIND`) as rows under the account and the Mac the agent
 * is pinned to (`packages/database/src/schemas/mac-agent.ts`); the Mac
 * follows them, as it follows `run_on_mac`'s commands, claims each by its
 * id, and settles or answers it.
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
