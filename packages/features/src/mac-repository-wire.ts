import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";

/**
 * mac-repository-wire.ts -- where a repository lives on this Mac and how it is run, and the terminal a coding agent's branch is opened in there.
 *
 * Each repository may name the folder of the developer's own local clone of
 * it and the command that runs it. Both are this Mac's alone, kept in its
 * settings file and never sent anywhere. Open on this Mac names the agent,
 * its repository, and its pushed branch; Luke opens a terminal of this Mac
 * in a tab of its own, whose shell brings the branch into a worktree of the
 * clone and runs the command there. What the terminal prints and what is
 * typed into it travel on a port between main and that one tab, and nowhere
 * else.
 */

export const MAC_REPOSITORY_BOUNDS = {
  MAX_FOLDER_CHARS: 1_024,
  MAX_COMMAND_CHARS: 4_096,
} as const;

/** A branch name as an agent pushes one: Git's own characters, no `..`, no leading `-`. */
const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,255}$/u;

/** One repository's folder and command on this Mac; null where it has none. */
export const macRepositorySchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  /** The absolute path of the developer's local clone. */
  folder: EffectSchema.NullOr(
    EffectSchema.String.check(
      EffectSchema.isPattern(/^\//u),
      EffectSchema.isMaxLength(MAC_REPOSITORY_BOUNDS.MAX_FOLDER_CHARS),
    ),
  ),
  command: EffectSchema.NullOr(
    EffectSchema.String.check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(MAC_REPOSITORY_BOUNDS.MAX_COMMAND_CHARS),
    ),
  ),
});

export type MacRepository = typeof macRepositorySchema.Type;

/** Every repository set on this Mac. */
export const macRepositoriesAnswerSchema = EffectSchema.Struct({
  repositories: EffectSchema.Array(macRepositorySchema),
});

export type MacRepositoriesAnswer = typeof macRepositoriesAnswerSchema.Type;

const terminalSize = (maximum: number) =>
  EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum }));

/** Opening the agent's branch in a terminal on this Mac: the agent, its repository and branch, and the terminal's size in cells. */
export const macTerminalOpenParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f-]{36}$/u)),
  repository: githubRepositoryFullNameSchema,
  branch: EffectSchema.String.check(EffectSchema.isPattern(BRANCH_PATTERN)),
  cols: terminalSize(1_000),
  rows: terminalSize(1_000),
});

export type MacTerminalOpenParams = typeof macTerminalOpenParamsSchema.Type;

/** A terminal on this Mac named by the agent whose branch it opened. */
export const macTerminalKeySchema = EffectSchema.Struct({
  agentId: macTerminalOpenParamsSchema.fields.agentId,
});

/** The channel a terminal's port is posted to its panel on, under its agent's id. */
export const MAC_TERMINAL_PORT_CHANNEL = "mac-terminal:port";

export const MAC_TERMINAL_PORT_MESSAGE = {
  /** main → renderer: what the terminal printed. */
  OUTPUT: "output",
  /** main → renderer: the shell ended, with its status. */
  EXIT: "exit",
  /** renderer → main: what was typed. */
  INPUT: "input",
  /** renderer → main: the terminal's size in cells. */
  RESIZE: "resize",
} as const;

export const macTerminalPortOutboundSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(MAC_TERMINAL_PORT_MESSAGE.OUTPUT),
    data: EffectSchema.Uint8Array,
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(MAC_TERMINAL_PORT_MESSAGE.EXIT),
    code: EffectSchema.NullOr(EffectSchema.Int),
  }),
]);

export type MacTerminalPortOutbound = typeof macTerminalPortOutboundSchema.Type;

export const macTerminalPortInboundSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(MAC_TERMINAL_PORT_MESSAGE.INPUT),
    data: EffectSchema.String.check(EffectSchema.isMaxLength(65_536)),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(MAC_TERMINAL_PORT_MESSAGE.RESIZE),
    cols: terminalSize(1_000),
    rows: terminalSize(1_000),
  }),
]);
