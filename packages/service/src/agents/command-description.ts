import { describeWire } from "@luke/wire/effect";
import { Schema } from "effect";

/**
 * command-description.ts -- the few plain words a model gives each command it runs, which the developer's transcript names the call by.
 *
 * Both shells a model is handed, the brain's `run_in_repository`
 * (`repository-shell.ts`) and a coding agent's `bash` (`coder-host/shell.ts`),
 * take one beside the command, as Claude Code's shell does, so a row reads
 * "Find where invites are sent" rather than a pipeline of `grep`s. It is
 * optional, so a call without one still runs, and it is never run nor handed
 * to the sandbox: it rides in the call's stored input, where the desktop reads
 * it for the row's title and draws the command in the row's body.
 */

/** The field as a model is shown it, beside a shell's `command`. */
export const COMMAND_DESCRIPTION = Schema.optionalKey(
  describeWire(
    Schema.String,
    "What the command is for, in plain English for the developer reading along: " +
      '3 to 8 words, sentence case, no trailing period, such as "Run the unit tests" or ' +
      '"Find where invites are sent".',
  ),
);

/** The line each model's instructions ask for it in. */
export const COMMAND_DESCRIPTION_INSTRUCTION =
  "Give every command a `description`, what it is for in 3 to 8 plain words, which the " +
  "developer reads in place of the command.";
