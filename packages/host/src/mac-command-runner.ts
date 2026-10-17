import {
  MAC_COMMAND_BOUNDS,
  type MacCommand,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { Duration, Effect, Fiber, Option, Ref, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * mac-command-runner.ts -- one command an agent asked of this Mac, run in the developer's login shell from their home folder, and what it printed.
 *
 * The command is handed to the shell whole as its `-c` argument, never
 * spliced into shell text, under the app's own environment with no pager
 * and no git prompt, and with nothing on its stdin, so a command that asks
 * for input reads its end. It runs as the leader of a process group of its
 * own, and at its timeout the group is sent SIGTERM and, if anything is
 * left, SIGKILL a few seconds later (the platform spawner's own group kill
 * as the command's scope closes). Each stream keeps its first
 * `MAX_OUTPUT_CHARS` characters and drains the rest, so a command that
 * prints without end still exits; what it printed before a timeout is
 * kept. A command that could not be started answers why on its stderr.
 */

const MAC_COMMAND_RUN = {
  /** How long the group has to end after SIGTERM before it is sent SIGKILL. */
  KILL_GRACE: Duration.seconds(3),
  /** How long the streams are read once the command exited or timed out, for what it wrote just before. */
  DRAIN_GRACE: Duration.seconds(1),
} as const;

/** Where a command runs: the developer's login shell and their home folder. */
export interface MacShell {
  readonly path: string;
  readonly home: string;
}

/** What the command's environment adds to the app's own: nothing that pages, and git asking nothing. */
const COMMAND_ENVIRONMENT = {
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
} as const;

/** The most bytes a stream keeps: every character of the bound at its widest UTF-8 spelling. */
const MAX_OUTPUT_BYTES = MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS * 4;

interface Captured {
  readonly chunks: readonly Uint8Array[];
  readonly bytes: number;
  readonly dropped: boolean;
}

const NOTHING_CAPTURED: Captured = { chunks: [], bytes: 0, dropped: false };

/** A chunk kept while the stream is under its byte bound, and the rest counted as dropped. */
function captureChunk(captured: Captured, chunk: Uint8Array): Captured {
  const room = MAX_OUTPUT_BYTES - captured.bytes;
  if (room <= 0) return { ...captured, dropped: true };
  const kept = chunk.length <= room ? chunk : chunk.subarray(0, room);
  return {
    chunks: [...captured.chunks, kept],
    bytes: captured.bytes + kept.length,
    dropped: captured.dropped || kept.length < chunk.length,
  };
}

/** A stream as the result carries it: its text cut to the bound, and whether anything was left out. */
interface CapturedText {
  readonly text: string;
  readonly cut: boolean;
}

function capturedText(captured: Captured): CapturedText {
  // Note that the chunks are decoded as one stream, so a character split across two is read whole.
  const decoder = new TextDecoder();
  const text =
    captured.chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") +
    decoder.decode();
  const cut = captured.dropped || text.length > MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS;
  return { text: text.slice(0, MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS), cut };
}

function drainInto<E>(stream: Stream.Stream<Uint8Array, E>, into: Ref.Ref<Captured>) {
  return Stream.runForEach(stream, (chunk) =>
    Ref.update(into, (held) => captureChunk(held, chunk)),
  );
}

/** The command run whole under its timeout, its group killed as the scope closes on a timeout. */
function runned(
  command: MacCommand,
  shell: MacShell,
): Effect.Effect<MacCommandResult, unknown, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(shell.path, ["-l", "-c", command.command], {
        cwd: shell.home,
        env: COMMAND_ENVIRONMENT,
        extendEnv: true,
        stdin: "ignore",
        forceKillAfter: MAC_COMMAND_RUN.KILL_GRACE,
      });
      const stdout = yield* Ref.make(NOTHING_CAPTURED);
      const stderr = yield* Ref.make(NOTHING_CAPTURED);
      const drains = yield* Effect.forkScoped(
        Effect.all([drainInto(handle.stdout, stdout), drainInto(handle.stderr, stderr)], {
          concurrency: 2,
        }),
      );
      const exited = yield* Effect.timeoutOption(
        handle.exitCode,
        Duration.seconds(command.timeoutSeconds),
      );
      // Note that the streams are waited on only briefly, because a child the command left running, or the command itself past its timeout, holds them open; what it wrote just before the end is read either way.
      yield* Effect.ignore(Effect.timeoutOption(Fiber.join(drains), MAC_COMMAND_RUN.DRAIN_GRACE));
      const out = capturedText(yield* Ref.get(stdout));
      const err = capturedText(yield* Ref.get(stderr));
      return {
        exitCode: Option.getOrNull(exited),
        stdout: out.text,
        stderr: err.text,
        truncated: out.cut || err.cut,
        timedOut: Option.isNone(exited),
      };
    }),
  );
}

/** One command run on this Mac, answering what it did; one that could not be started answers why. */
export function runMacCommand(
  command: MacCommand,
  shell: MacShell,
): Effect.Effect<MacCommandResult, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.catch(runned(command, shell), (error) =>
    Effect.succeed({
      exitCode: null,
      stdout: "",
      stderr:
        `Luke could not start the command: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS,
        ),
      truncated: false,
      timedOut: false,
    }),
  );
}
