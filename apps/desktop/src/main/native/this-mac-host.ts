import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEVICE_ARCH } from "@repo/features/device-agent-wire";
import { DARWIN_HOST } from "@repo/host/daemon";
import { ThisMacHost, type ThisMacHostSeam } from "@repo/host/effect";
import { Duration, Effect, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { app } from "electron";

const LABEL = "dev.vespin.host.standalone";

const MAC_MIN_VERSION = [13, 5] as const;

const ANSWER_WITHIN = {
  LAUNCHD: Duration.seconds(30),
  INSTALL: Duration.minutes(10),
} as const;

const machine = Effect.sync(() => ({
  name: DARWIN_HOST.deviceName(),
  platform: DARWIN_HOST.platform,
  arch: DEVICE_ARCH.ARM64,
  ...DARWIN_HOST.machine(),
}));

function macOsTakesHost(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [needMajor, needMinor] = MAC_MIN_VERSION;
  return major > needMajor || (major === needMajor && minor >= needMinor);
}

export const printed = (
  command: string,
  args: readonly string[],
  within: Duration.Duration,
  input?: string,
): Effect.Effect<Result.Result<string, string>, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args], {
        stdin: input === undefined ? "ignore" : Stream.make(new TextEncoder().encode(input)),
      });
      const [out, said] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" },
      );
      const code = Number(yield* handle.exitCode);
      return code === 0
        ? Result.succeed(out)
        : Result.fail(said.trim() || `${command} ${args.join(" ")} exited ${code}`);
    }),
  ).pipe(
    Effect.timeoutOption(within),
    Effect.map(
      Option.getOrElse(() =>
        Result.fail<string>(`${command} did not answer in ${Duration.format(within)}`),
      ),
    ),
    Effect.catch((failure) => Effect.succeed(Result.fail(`${command}: ${String(failure)}`))),
  );

const ran = (command: string, args: readonly string[], within: Duration.Duration, input?: string) =>
  Effect.map(
    printed(command, args, within, input),
    Result.map((): void => undefined),
  );

const launchctl = (args: readonly string[]) => ran("launchctl", args, ANSWER_WITHIN.LAUNCHD);

const INSTALL_COMMAND = ".local/bin/vespin-host";

function thisMacHost(): ThisMacHostSeam {
  const agent = `gui/${process.getuid?.() ?? 0}/${LABEL}`;
  const loaded = Effect.map(launchctl(["print", agent]), Result.isSuccess);
  return {
    stateRoot: DARWIN_HOST.stateRoot(os.homedir()),
    runsHost:
      process.platform === "darwin" &&
      (process.arch === "arm64" || app.runningUnderARM64Translation) &&
      macOsTakesHost(process.getSystemVersion()),
    machine,
    loaded,
    install: (script) =>
      Effect.flatMap(launchctl(["enable", agent]), (enabled) =>
        Result.isFailure(enabled)
          ? Effect.succeed(enabled)
          : ran("/bin/sh", ["-s"], ANSWER_WITHIN.INSTALL, script),
      ),
    stop: Effect.gen(function* () {
      const disabled = yield* launchctl(["disable", agent]);
      if (Result.isFailure(disabled)) return disabled;
      yield* launchctl(["bootout", agent]);
      return (yield* loaded)
        ? Result.fail(`launchd still holds ${LABEL}`)
        : Result.succeed<void>(undefined);
    }),
    uninstall: Effect.suspend(() => {
      const command = path.join(os.homedir(), INSTALL_COMMAND);
      return existsSync(command)
        ? ran(command, ["uninstall"], ANSWER_WITHIN.INSTALL)
        : Effect.succeed(Result.succeed<void>(undefined));
    }),
  };
}

export function thisMacHostLayer() {
  return Layer.sync(ThisMacHost, thisMacHost);
}
