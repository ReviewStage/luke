/**
 * output.ts -- how a `vespin` command speaks: its answer on stdout as JSON, lines, or ids, its notes and failures on stderr, and what it reads from stdin or a file.
 *
 * A command never writes to stdout itself. It hands `answer` the three
 * readings of what it found, and the flags and the terminal decide which
 * one is printed: JSON with `--json` or wherever stdout is not a terminal,
 * so a script or a coding agent always reads JSON; the ids alone with
 * `-q`; the lines a person reads otherwise. Everything else a command says
 * (a link to open, that it is waiting, why it failed) goes to stderr, so
 * stdout stays the answer alone.
 *
 * A command asks a person nothing unless stdin is a terminal (`canPrompt`):
 * where it is not, what it would ask is read from stdin as input.
 */

import { CLI_EXIT, type CliExit } from "@repo/features/cli-exit";
import { Console, Data, Effect, FileSystem, Option, Stdio, Stream, Terminal } from "effect";
import { JSON_FLAG, QUIET_FLAG } from "./flags.js";

/** The `-F` value that names stdin rather than a file. */
const STDIN_SOURCE = "-";

/** The indent JSON is printed with, so a person reading it can. */
const JSON_INDENT = 2;

/**
 * A command that ended short: the exit code it ends with and the sentence
 * that says why, printed on stderr. Its words never carry a token.
 */
export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly exit: CliExit;
  readonly message: string;
}> {}

/** What a command found, as each reader takes it. */
export interface Answer {
  /** What `--json`, and stdout that is not a terminal, prints. */
  readonly json: unknown;
  /** What a person at a terminal reads. */
  readonly lines: readonly string[];
  /** What `-q` prints, one a line; none prints nothing. */
  readonly ids?: readonly string[];
}

/** Whether this run prints JSON: asked for, or stdout is not a terminal. */
const printsJson = Effect.gen(function* () {
  const asked = yield* JSON_FLAG;
  if (asked) return true;
  const stdio = yield* Stdio.Stdio;
  return !(yield* stdio.stdoutIsTerminal);
});

/** A command's answer on stdout, in the one reading the flags and the terminal choose. */
export const answer = Effect.fnUntraced(function* (found: Answer) {
  if (yield* QUIET_FLAG) {
    for (const id of found.ids ?? []) yield* Console.log(id);
    return;
  }
  if (yield* printsJson) {
    yield* Console.log(JSON.stringify(found.json, null, JSON_INDENT));
    return;
  }
  for (const line of found.lines) yield* Console.log(line);
});

/**
 * Lines of an answer a person reads as they come, such as a turn followed
 * live, on stdout; nothing with `-q` or where the run prints JSON, whose
 * reader takes the whole answer once it is done.
 */
export const streamLines = Effect.fnUntraced(function* (lines: readonly string[]) {
  if ((yield* QUIET_FLAG) || (yield* printsJson)) return;
  for (const line of lines) yield* Console.log(line);
});

/** A note for the person running the command, on stderr, where it never mixes with the answer. */
export function note(line: string): Effect.Effect<void> {
  return Console.error(line);
}

/** Whether the command may ask the person something: stdin is a terminal. */
const canPrompt = Effect.flatMap(Stdio.Stdio, (stdio) => stdio.stdinIsTerminal);

const stdinText = Effect.flatMap(Stdio.Stdio, (stdio) =>
  Stream.mkString(Stream.decodeText(stdio.stdin)),
);

/**
 * One line from the person: asked with `prompt` where stdin is a terminal,
 * or the first line of stdin where it is not. Nothing where stdin ended
 * before a line, or the person quit.
 */
export const readLine = Effect.fnUntraced(function* (prompt: string) {
  if (yield* canPrompt) {
    yield* note(prompt);
    const terminal = yield* Terminal.Terminal;
    return yield* Effect.option(terminal.readLine).pipe(Effect.map(Option.getOrUndefined));
  }
  const piped = yield* Effect.orElseSucceed(stdinText, () => "");
  return piped.split("\n")[0];
});

/** The text a `-F <file|->` names: the file's, or stdin's for `-`, or why it could not be read. */
export const readInput = Effect.fnUntraced(function* (source: string) {
  if (source === STDIN_SOURCE) {
    return yield* Effect.mapError(
      stdinText,
      () => new CommandFailed({ exit: CLI_EXIT.USAGE, message: "Could not read stdin." }),
    );
  }
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* Effect.mapError(
    fileSystem.readFileString(source),
    () => new CommandFailed({ exit: CLI_EXIT.USAGE, message: `Could not read ${source}.` }),
  );
});

/** The space between a table's columns. */
const COLUMN_GAP = "  ";

/**
 * Rows of cells as a person reads a table at a terminal: each column as
 * wide as its widest cell, the last left ragged, so a long name never pads
 * the line past it.
 */
export function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join(COLUMN_GAP)
      .trimEnd(),
  );
}
