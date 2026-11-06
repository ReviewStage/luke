import { CLI_EXIT, type CliExit } from "@repo/features/cli-exit";
import { Console, Data, Effect, FileSystem, Option, Stdio, Stream, Terminal } from "effect";
import { JSON_FLAG, QUIET_FLAG } from "./flags.js";

const STDIN_SOURCE = "-";

const JSON_INDENT = 2;

export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly exit: CliExit;
  readonly message: string;
}> {}

export interface Answer {
  readonly json: unknown;
  readonly lines: readonly string[];
  readonly ids?: readonly string[];
}

const printsJson = Effect.gen(function* () {
  const asked = yield* JSON_FLAG;
  if (asked) return true;
  const stdio = yield* Stdio.Stdio;
  return !(yield* stdio.stdoutIsTerminal);
});

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

export const streamLines = Effect.fnUntraced(function* (lines: readonly string[]) {
  if ((yield* QUIET_FLAG) || (yield* printsJson)) return;
  for (const line of lines) yield* Console.log(line);
});

export function note(line: string): Effect.Effect<void> {
  return Console.error(line);
}

const canPrompt = Effect.flatMap(Stdio.Stdio, (stdio) => stdio.stdinIsTerminal);

const stdinText = Effect.flatMap(Stdio.Stdio, (stdio) =>
  Stream.mkString(Stream.decodeText(stdio.stdin)),
);

export const readLine = Effect.fnUntraced(function* (prompt: string) {
  if (yield* canPrompt) {
    yield* note(prompt);
    const terminal = yield* Terminal.Terminal;
    return yield* Effect.option(terminal.readLine).pipe(Effect.map(Option.getOrUndefined));
  }
  const piped = yield* Effect.orElseSucceed(stdinText, () => "");
  return piped.split("\n")[0];
});

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

const COLUMN_GAP = "  ";

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
