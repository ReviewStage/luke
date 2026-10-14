import { Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";

/**
 * terminal-wire.ts -- a coding agent's terminals, as the desktop lists, names, and ends them, and how its sandbox stands.
 *
 * A Terminal tab belongs to one coding agent's sandbox, never to the plan.
 * Each of its shells is a tmux session in that sandbox, which outlives any
 * connection to it, so the list is read from the sandbox itself: one row
 * per shell, its name, what it is running, and where. The list never wakes a
 * stopped sandbox; only the resume path does, on the developer's click.
 * Every request refuses a key it does not name, as every request frame on
 * this wire does.
 */

/** Where the agent's sandbox stands, as the tab reads it. */
export const SANDBOX_STATE = {
  /** Up: its shells can be listed, started, and attached. */
  RUNNING: "running",
  /** Stopped with its files kept; its shells ended with it, and it comes back only on the developer's resume. */
  STOPPED: "stopped",
  /** Not open yet: the agent opens its sandbox on its first command, or it is still coming up. */
  STARTING: "starting",
} as const;

export type SandboxState = (typeof SANDBOX_STATE)[keyof typeof SANDBOX_STATE];

const TERMINAL_BOUNDS = {
  /** The most characters of a shell's name. */
  MAX_TITLE_CHARS: 60,
} as const;

/** A shell's name: a short line of printable characters, since it is shown in a list and stored as a tmux option. */
const title = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(TERMINAL_BOUNDS.MAX_TITLE_CHARS),
  EffectSchema.isPattern(/^\P{Cc}+$/u),
);

/**
 * One shell in the agent's sandbox: its id, the name the developer gave it
 * or the shell's own, what its foreground process is, the folder it stands
 * in, and whether something other than the shell itself is running there.
 */
const terminalSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  title: EffectSchema.String,
  command: EffectSchema.String,
  cwd: EffectSchema.String,
  running: EffectSchema.Boolean,
});

export type TerminalSummary = typeof terminalSummarySchema.Type;

/** The agent's shells (GET), oldest first, and where its sandbox stands; none while it is not running. */
export const terminalsAnswerSchema = EffectSchema.Struct({
  sandbox: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
  terminals: EffectSchema.Array(terminalSummarySchema),
});

export type TerminalsAnswer = typeof terminalsAnswerSchema.Type;

/** A new shell in the agent's sandbox (POST), named where the developer named it. */
export const terminalCreateRequestSchema = EffectSchema.Struct({
  title: EffectSchema.optional(title),
});

/** The shell started (POST). */
export const terminalCreatedAnswerSchema = EffectSchema.Struct({
  terminal: terminalSummarySchema,
});

/** A shell's new name (PATCH). */
export const terminalRenameRequestSchema = EffectSchema.Struct({ title });

/** Where the sandbox stands once a resume answered (POST). */
export const sandboxResumedAnswerSchema = EffectSchema.Struct({
  sandbox: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
});
