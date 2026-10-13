/**
 * scripted-spawner.ts -- a `ChildProcessSpawner` that runs nothing: each spawn plays the script a test wrote for it, on the test's clock.
 *
 * A script prints its stdout and stderr at once and exits with its code
 * after its delay, or never where it names no code. The spawner keeps the
 * platform's one promise about the scope a process is spawned in: a process
 * still running when that scope closes is ended, group and all, under the
 * signal and the SIGKILL grace its command asked for. What the process was
 * handed (program, arguments, working directory, environment, stdin) and
 * how it ended are kept for the test to read, which is what the operating
 * system would observe.
 */

import { Deferred, Duration, Effect, Layer, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";

/** What one spawned process does. */
export interface Script {
  readonly stdout?: string;
  readonly stderr?: string;
  /** The code it exits with on its own; absent, it runs until it is ended. */
  readonly exitCode?: number;
  /** How long it runs before it exits on its own. */
  readonly after?: Duration.Input;
}

/** One process as the operating system saw it: what it was handed, and how it ended. */
interface Spawned {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
  readonly extendEnv: boolean | undefined;
  readonly stdin: ChildProcess.CommandOptions["stdin"];
  /** How it ended: on its own, or ended with its group under the command's kill options. */
  ended:
    | "exited"
    | "running"
    | { readonly killSignal: string; readonly forceKillAfterMillis: number };
}

export interface ScriptedSpawner {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  /** Every process spawned so far, in order. */
  readonly spawned: readonly Spawned[];
}

const encoder = new TextEncoder();

function bytes(text: string | undefined): Stream.Stream<Uint8Array> {
  return text === undefined || text === "" ? Stream.empty : Stream.make(encoder.encode(text));
}

/** A spawner playing `scriptFor`'s answer for each command; a command it answers nothing for fails to start. */
export function scriptedSpawner(
  scriptFor: (program: string, args: readonly string[]) => Script | undefined,
): ScriptedSpawner {
  const spawned: Spawned[] = [];
  const spawn = (command: ChildProcess.Command) =>
    Effect.gen(function* () {
      if (command._tag !== "StandardCommand") return yield* Effect.die("a pipeline was spawned");
      const script = scriptFor(command.command, command.args);
      if (script === undefined) {
        return yield* Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            description: `no such file: ${command.command}`,
          }),
        );
      }
      const record: Spawned = {
        program: command.command,
        args: command.args,
        cwd: command.options.cwd,
        env: command.options.env,
        extendEnv: command.options.extendEnv,
        stdin: command.options.stdin,
        ended: "running",
      };
      spawned.push(record);
      const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      if (script.exitCode !== undefined) {
        const code = ChildProcessSpawner.ExitCode(script.exitCode);
        yield* Effect.forkScoped(
          Effect.sleep(script.after ?? Duration.zero).pipe(
            Effect.andThen(Effect.sync(() => (record.ended = "exited"))),
            Effect.andThen(Deferred.succeed(exit, code)),
          ),
        );
      }
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (record.ended !== "running") return;
          record.ended = {
            killSignal: command.options.killSignal ?? "SIGTERM",
            forceKillAfterMillis: Duration.toMillis(command.options.forceKillAfter ?? 0),
          };
        }),
      );
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(spawned.length),
        exitCode: Deferred.await(exit),
        isRunning: Effect.map(Deferred.isDone(exit), (done) => !done),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: bytes(script.stdout),
        stderr: bytes(script.stderr),
        all: Stream.concat(bytes(script.stdout), bytes(script.stderr)),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    });
  return {
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(spawn)),
    spawned,
  };
}
