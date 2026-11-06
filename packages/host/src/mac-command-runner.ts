import {
  MAC_COMMAND_BOUNDS,
  type MacShellCommand,
  type MacShellResult,
} from "@repo/features/mac-command-wire";
import { Duration, Effect, Fiber, Option, Ref, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

const MAC_COMMAND_RUN = {
  KILL_GRACE: Duration.seconds(3),
  DRAIN_GRACE: Duration.seconds(1),
} as const;

export interface MacShell {
  readonly path: string;
  readonly home: string;
}

const COMMAND_ENVIRONMENT = {
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
} as const;

const MAX_OUTPUT_BYTES = MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS * 4;

interface Captured {
  readonly chunks: readonly Uint8Array[];
  readonly bytes: number;
  readonly dropped: boolean;
}

const NOTHING_CAPTURED: Captured = { chunks: [], bytes: 0, dropped: false };

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

interface CapturedText {
  readonly text: string;
  readonly cut: boolean;
}

function capturedText(captured: Captured): CapturedText {
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

function runned(
  command: MacShellCommand,
  shell: MacShell,
): Effect.Effect<MacShellResult, unknown, ChildProcessSpawner.ChildProcessSpawner> {
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

export function runMacCommand(
  command: MacShellCommand,
  shell: MacShell,
): Effect.Effect<MacShellResult, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.catch(runned(command, shell), (error) =>
    Effect.succeed({
      exitCode: null,
      stdout: "",
      stderr:
        `Could not start the command: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS,
        ),
      truncated: false,
      timedOut: false,
    }),
  );
}
