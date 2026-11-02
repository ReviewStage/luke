import os from "node:os";
import path from "node:path";
import { DEVICE_ARCH } from "@luke/features/device-agent-wire";
import { DARWIN_HOST } from "@luke/host/daemon";
import { ThisMacHost, type ThisMacHostSeam } from "@luke/host/effect";
import { Duration, Effect, Layer, Option, Result, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { app } from "electron";

/**
 * host-login-item.ts -- This Mac's host as the host asks it (`@luke/host/effect`'s `ThisMacHost`): the account install the install command puts on a Mac, its LaunchAgent started or stopped through launchd, and the install script run.
 *
 * The install lives under the member's own home, by the names the install
 * script gives it (`apps/web/install/install.sh`): its state, holding the
 * record its host runs on, in `~/.local/state/luke-host`, and its
 * LaunchAgent, `dev.vespin.host.standalone`, which runs its host at login.
 * Every build of the app, a development run among them, acts on that one
 * install, never a state folder of its own. Stopping it boots the
 * LaunchAgent out and disables it, which keeps it from starting at the next
 * login with its plist and files left in place; the install script enables
 * it again before it runs, since launchd starts no disabled job.
 */

/** The account install's LaunchAgent, by its label (`MAC_LABEL` in the install script). */
const LABEL = "dev.vespin.host.standalone";

/** The account install's state folder, under the home (`ACCOUNT_STATE` in `apps/host/scripts/luke-host.sh`). */
const STATE_FOLDER = path.join(".local", "state", "luke-host");

/** The oldest macOS the install script installs on (`MAC_MIN_VERSION` in the install script). */
const MAC_MIN_VERSION = [12, 3] as const;

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

/** The command given run once, its input on stdin where it is given some: nothing where it exited 0, or the words it failed with. */
const ran = (command: string, args: readonly string[], within: Duration.Duration, input?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args], {
        stdin: input === undefined ? "ignore" : Stream.make(new TextEncoder().encode(input)),
      });
      const [, said] = yield* Effect.all(
        [Stream.runDrain(handle.stdout), Stream.mkString(Stream.decodeText(handle.stderr))],
        { concurrency: "unbounded" },
      );
      const code = Number(yield* handle.exitCode);
      return code === 0
        ? Result.succeed<void>(undefined)
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

const launchctl = (args: readonly string[]) => ran("launchctl", args, ANSWER_WITHIN.LAUNCHD);

/** The account install as This Mac's host, for the user the app runs as. */
function thisMacHost(): ThisMacHostSeam {
  const agent = `gui/${process.getuid?.() ?? 0}/${LABEL}`;
  const loaded = Effect.map(launchctl(["print", agent]), Result.isSuccess);
  return {
    stateRoot: path.join(os.homedir(), STATE_FOLDER),
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
  };
}

/** This Mac's host for the host: the account install, whichever build of the app runs. */
export function thisMacHostLayer() {
  return Layer.sync(ThisMacHost, thisMacHost);
}
