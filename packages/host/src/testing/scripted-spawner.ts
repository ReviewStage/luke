import { Deferred, Duration, Effect, Layer, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import type { ChildProcess } from "effect/process";
import { ChildProcessSpawner } from "effect/process";

export interface Script {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly after?: Duration.Input;
  readonly until?: Effect.Effect<void>;
  readonly killed?: Effect.Effect<void>;
}

interface Killed {
  readonly killSignal: string;
  readonly forceKillAfterMillis: number;
}

interface Spawned {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
  readonly extendEnv: boolean | undefined;
  readonly stdin: ChildProcess.CommandOptions["stdin"];
  ended: "exited" | "running" | Killed;
  killed: Killed | undefined;
}

export interface ScriptedSpawner {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly spawned: readonly Spawned[];
}

const encoder = new TextEncoder();

function bytes(text: string | undefined): Stream.Stream<Uint8Array> {
  return text === undefined || text === "" ? Stream.empty : Stream.make(encoder.encode(text));
}

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
        killed: undefined,
      };
      spawned.push(record);
      const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      if (script.exitCode !== undefined) {
        const code = ChildProcessSpawner.ExitCode(script.exitCode);
        yield* Effect.forkScoped(
          (script.until ?? Effect.sleep(script.after ?? Duration.zero)).pipe(
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
        kill: (options) =>
          Effect.gen(function* () {
            if (yield* Deferred.isDone(exit)) return;
            record.killed = {
              killSignal: options?.killSignal ?? command.options.killSignal ?? "SIGTERM",
              forceKillAfterMillis: Duration.toMillis(options?.forceKillAfter ?? 0),
            };
            yield* script.killed ?? Effect.void;
          }),
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
