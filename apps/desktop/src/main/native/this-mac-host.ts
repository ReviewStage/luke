import os from "node:os";
import path from "node:path";
import { DEVICE_ARCH } from "@repo/features/device-agent-wire";
import { DARWIN_HOST } from "@repo/host/daemon";
import { ThisMacHost, type ThisMacHostSeam } from "@repo/host/effect";
import { Duration, Effect, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { app } from "electron";

/**
 * this-mac-host.ts -- This Mac's host as the host asks it (`@repo/host/effect`'s `ThisMacHost`): the account install the install command puts on a Mac, its LaunchAgent started or stopped through launchd, and the install script run.
 *
 * The install lives under the member's own home, by the names the install
 * script gives it (`apps/web/install/install.sh`): its state, holding the
 * record its host runs on, in `~/.local/state/vespin-host`, and its
 * LaunchAgent, `dev.vespin.host.standalone`, which runs its host at login.
 * Every build of the app, a development run among them, acts on that one
 * install, never a state folder of its own. Stopping it boots the
 * LaunchAgent out and disables it, which keeps it from starting at the next
 * login with its plist and files left in place; the install script enables
 * it again before it runs, since launchd starts no disabled job.
 */

/** The account install's LaunchAgent, by its label (`MAC_LABEL` in the install script). */
const LABEL = "dev.vespin.host.standalone";

/** The oldest macOS the install script installs on (`MAC_MIN_VERSION` in the install script): the release's Node needs 13.5. */
const MAC_MIN_VERSION = [13, 5] as const;

/** How long launchd may take to answer; the install script, which downloads a release, longer. */
const ANSWER_WITHIN = {
  LAUNCHD: Duration.seconds(30),
  INSTALL: Duration.minutes(10),
} as const;

/** The Mac as its host registers it (`DARWIN_HOST`), on Apple silicon alone. */
const machine = Effect.sync(() => ({
  name: DARWIN_HOST.deviceName(),
  platform: DARWIN_HOST.platform,
  arch: DEVICE_ARCH.ARM64,
  ...DARWIN_HOST.machine(),
}));

/** Whether macOS, as Electron reads its version, is the install script's oldest or later. */
function macOsTakesHost(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [needMajor, needMinor] = MAC_MIN_VERSION;
  return major > needMajor || (major === needMajor && minor >= needMinor);
}

/**
 * The command given run once, its input on stdin where it is given some: what
 * it printed where it exited 0, or the words it failed with. Note that the
 * `vespin` command's install runs through this too (`./cli-install.ts`), so
 * both installs run their script the same way.
 */
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

/** The command given run once, as `printed` runs it: nothing where it exited 0, or the words it failed with. */
const ran = (command: string, args: readonly string[], within: Duration.Duration, input?: string) =>
  Effect.map(
    printed(command, args, within, input),
    Result.map((): void => undefined),
  );

const launchctl = (args: readonly string[]) => ran("launchctl", args, ANSWER_WITHIN.LAUNCHD);

/** The install's own command, by the link the install script makes under the home (`HOST_COMMAND`). */
const INSTALL_COMMAND = ".local/bin/vespin-host";

/** The account install as This Mac's host, for the user the app runs as. */
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
    // Note that a bootout of a job launchd holds no longer fails, so it is read past and the job read again.
    stop: Effect.gen(function* () {
      const disabled = yield* launchctl(["disable", agent]);
      if (Result.isFailure(disabled)) return disabled;
      yield* launchctl(["bootout", agent]);
      return (yield* loaded)
        ? Result.fail(`launchd still holds ${LABEL}`)
        : Result.succeed<void>(undefined);
    }),
    // Note that its input is no terminal, so it asks nothing and removes every agent's folder.
    uninstall: ran(path.join(os.homedir(), INSTALL_COMMAND), ["uninstall"], ANSWER_WITHIN.INSTALL),
  };
}

/** This Mac's host for the host: the account install, whichever build of the app runs. */
export function thisMacHostLayer() {
  return Layer.sync(ThisMacHost, thisMacHost);
}
