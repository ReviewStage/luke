import { DEVICE_PLATFORM, type DevicePlatform } from "@luke/features/device-agent-wire";
import { PRODUCT_NAME } from "@luke/features/product-name";
import { Duration, Effect, Option, Path, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess } from "effect/process";
import { Reporter } from "../effect/seams.js";

/**
 * host-service-move.ts -- an account install's service moved over to the `vespin-host` program by the daemon a service of a release before the rename started: on Linux from `luke-host.service` to `vespin-host.service`, on a Mac its LaunchAgent's plist rewritten in place, and on both the command's `~/.local/bin/vespin-host` link made.
 *
 * A host through 0.6.0 updates itself to a later release and starts it
 * again through the service its install wrote, which names the release's
 * `bin/luke-host`, a link to `bin/vespin-host` from the rename on. That
 * daemon moves its own service over before it follows any agent, and only a
 * daemon its service started does (`hostServiceOf`): one run by hand, or
 * from an install that came before, is handed nothing to move by `apps/host`.
 * Each step is one the next start can take again, so a move cut off or failed
 * is taken up again then, and one already made does nothing.
 *
 * On Linux the new unit is written as the install script writes its own
 * (`write_unit` in `apps/web/install/install.sh`), then enabled and started
 * while the old one still is, so a box cut off at any step still has a unit
 * enabled that starts the host; the follower lease (`follower-lock.ts`) keeps
 * the two daemons from following at once meanwhile. Once the new unit runs,
 * the old one is disabled and stopped, which stops the daemon that moved it,
 * and its file removed: it hands the host over (`HOST_SERVICE_MOVE`) and
 * follows nothing while systemd stops it. A daemon the new unit starts finds
 * an old unit's file still standing and retires it the same way.
 *
 * On a Mac the plist keeps its label, which every desktop build finds it by,
 * and is rewritten in place as the install script writes it
 * (`write_launch_agent`), running `vespin-host` and logging to
 * `vespin-host.log`. Note that launchd is not asked to load it again, since
 * a reload from inside the job boots the job out, and the daemon asking with
 * it, which could leave the Mac with no host running: the rewritten plist
 * takes effect the next time launchd loads the job, at the next login or
 * when the app or the install script loads it, and until then launchd starts
 * the release through `bin/luke-host` as it did.
 *
 * The old command's link `~/.local/bin/luke-host` stays where the install
 * made it, since an older app's Remove names it.
 */

/** What runs an account install's daemon: its systemd user unit on Linux, the one a release before the rename wrote among them, or its LaunchAgent on a Mac, by its label. */
export const HOST_SERVICE = {
  UNIT: "vespin-host.service",
  UNIT_BEFORE_RENAME: "luke-host.service",
  LAUNCH_AGENT: "dev.vespin.host.standalone",
} as const;

export type HostService = (typeof HOST_SERVICE)[keyof typeof HOST_SERVICE];

/** How a move ended: the daemon runs on where it is, or it handed the host over to the new unit, which runs it now, and its own is being stopped. */
export const HOST_SERVICE_MOVE = { STAYS: "stays", HANDED_OVER: "handed-over" } as const;

/** Where the account install keeps what the move writes, under its home. */
const ACCOUNT = {
  LINK: [".local", "bin", "vespin-host"],
  UNIT_FOLDER: [".config", "systemd", "user"],
  LAUNCH_AGENTS: ["Library", "LaunchAgents"],
  LOG: ["Library", "Logs", `${PRODUCT_NAME} Host`, "vespin-host.log"],
} as const;

/** The command under the releases' `current`, by its old name and its new. */
const COMMAND = {
  BEFORE_RENAME: ["current", "bin", "luke-host"],
  RENAMED: ["current", "bin", "vespin-host"],
} as const;

/** What a file the move writes is written beside, then renamed over it, so it never stands half written. */
const NEXT_SUFFIX = ".next";

/** How long systemd may take to answer an ask. */
const SYSTEMCTL_ANSWER = Duration.seconds(30);

/** The account's unit, as `write_unit` writes it, running the release's `vespin-host` through `current`. */
function unitText(command: string): string {
  return [
    "[Unit]",
    `Description=${PRODUCT_NAME} host`,
    "Documentation=https://vespin.dev",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${command} run`,
    "Restart=always",
    "RestartSec=60",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** The account's LaunchAgent, as `write_launch_agent` writes it, running the command given and logging to the log given. */
function launchAgentText(command: string, log: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${HOST_SERVICE.LAUNCH_AGENT}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${command}</string>
\t\t<string>run</string>
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>ThrottleInterval</key>
\t<integer>60</integer>
\t<key>StandardOutPath</key>
\t<string>${log}</string>
\t<key>StandardErrorPath</key>
\t<string>${log}</string>
</dict>
</plist>
`;
}

/**
 * The service of ours that runs the daemon, read off what its service
 * manager hands it: on Linux the unit its control group names, the last part
 * of a path in `/proc/self/cgroup`, and on a Mac the label launchd names its
 * job by (`XPC_SERVICE_NAME`); none for a run by hand, or by a service not
 * ours.
 */
export function hostServiceOf(input: {
  readonly platform: DevicePlatform;
  readonly cgroup: string;
  readonly launchdLabel: string | undefined;
}): HostService | undefined {
  if (input.platform === DEVICE_PLATFORM.DARWIN) {
    return input.launchdLabel === HOST_SERVICE.LAUNCH_AGENT ? HOST_SERVICE.LAUNCH_AGENT : undefined;
  }
  const units = input.cgroup.split("\n").map((line) => line.slice(line.lastIndexOf("/") + 1));
  return [HOST_SERVICE.UNIT, HOST_SERVICE.UNIT_BEFORE_RENAME].find((unit) => units.includes(unit));
}

export interface HostServiceMoveOptions {
  /** The service of ours that runs the daemon (`hostServiceOf`). */
  readonly service: HostService;
  /** The home the account install is in. */
  readonly home: string;
  /** The install's releases folder (`HostReleases.folder`), whose `current` names the release that runs. */
  readonly releases: string;
}

/** The daemon's service moved over to `vespin-host`, each step reported where it failed, which leaves it to the next start; how the move ended. */
export const hostServiceMoved = Effect.fnUntraced(function* (options: HostServiceMoveOptions) {
  const { report } = yield* Reporter;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { home, releases, service } = options;
  const command = path.join(releases, ...COMMAND.RENAMED);
  const unitFile = (unit: string) => path.join(home, ...ACCOUNT.UNIT_FOLDER, unit);

  const failed = (reason: string) =>
    Effect.sync(() =>
      report(
        `${PRODUCT_NAME} host: could not move its service over to vespin-host: ${reason}. It runs on as it is, and tries again at its next start.`,
      ),
    );

  /** `systemctl --user` asked what is given; the words it failed with where it did not answer 0. */
  const systemctl = (args: readonly string[]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make("systemctl", ["--user", ...args], {
          stdin: "ignore",
          stdout: "ignore",
        });
        const said = yield* Stream.mkString(Stream.decodeText(handle.stderr));
        const code = Number(yield* handle.exitCode);
        if (code !== 0) return yield* Effect.fail(said.trim() || `exited ${code}`);
      }),
    ).pipe(
      Effect.timeoutOption(SYSTEMCTL_ANSWER),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(`it did not answer in ${Duration.format(SYSTEMCTL_ANSWER)}`),
          onSome: () => Effect.void,
        }),
      ),
      Effect.mapError(
        (failure) =>
          `systemctl --user ${args.join(" ")}: ${typeof failure === "string" ? failure : "it could not be run"}`,
      ),
    );

  /** The file given holding the text given, written beside it and renamed over it, left alone where it holds that already. */
  const written = (file: string, text: string) =>
    Effect.gen(function* () {
      const standing = yield* Effect.option(fileSystem.readFileString(file));
      if (Option.contains(standing, text)) return;
      yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
      yield* fileSystem.writeFileString(`${file}${NEXT_SUFFIX}`, text, { mode: 0o644 });
      yield* fileSystem.rename(`${file}${NEXT_SUFFIX}`, file);
    }).pipe(Effect.mapError(() => `${file} could not be written`));

  /** The command's new link, made where nothing stands in its place; anything that does is left as it is. */
  const linked = Effect.gen(function* () {
    const link = path.join(home, ...ACCOUNT.LINK);
    if (Option.isSome(yield* Effect.option(fileSystem.readLink(link)))) return;
    if (yield* fileSystem.exists(link)) return;
    yield* fileSystem.makeDirectory(path.dirname(link), { recursive: true });
    yield* fileSystem.symlink(command, link);
  }).pipe(Effect.mapError(() => `${path.join(home, ...ACCOUNT.LINK)} could not be made`));

  /**
   * The old unit disabled, stopped without waiting, which stops the daemon it
   * runs where it runs one, and its file removed; the reason where the stop
   * was not asked. Note that the file goes last, so a daemon stopped before
   * it went leaves it for the new unit's daemon to find and retire.
   */
  const oldUnitRetired = Effect.gen(function* () {
    const unit = HOST_SERVICE.UNIT_BEFORE_RENAME;
    // Note that a disable fails where the unit's file is gone already, which leaves nothing to start it again, so it is passed over.
    yield* Effect.ignore(systemctl(["disable", unit]));
    yield* systemctl(["stop", "--no-block", unit]);
    yield* fileSystem
      .remove(unitFile(unit), { force: true })
      .pipe(Effect.mapError(() => `${unitFile(unit)} could not be removed`));
    yield* systemctl(["daemon-reload"]);
  });

  /** A Linux daemon of the old unit's: the new unit written, enabled and started beside the old one, then the old one retired, which hands the host over. */
  const unitMoved = Effect.gen(function* () {
    yield* written(unitFile(HOST_SERVICE.UNIT), unitText(command));
    yield* systemctl(["daemon-reload"]);
    yield* systemctl(["enable", HOST_SERVICE.UNIT]);
    yield* systemctl(["start", HOST_SERVICE.UNIT]);
    // Note that this is said before the old unit is stopped, which may stop this daemon before it says anything more.
    report(`${PRODUCT_NAME} host: moved its service to ${HOST_SERVICE.UNIT}, which runs it now.`);
    yield* oldUnitRetired;
    return HOST_SERVICE_MOVE.HANDED_OVER;
  });

  /** A Linux daemon of the new unit's: an old unit whose file still stands retired. */
  const leftRetired = Effect.gen(function* () {
    const left = yield* fileSystem
      .exists(unitFile(HOST_SERVICE.UNIT_BEFORE_RENAME))
      .pipe(Effect.orElseSucceed(() => false));
    if (left) yield* oldUnitRetired;
  });

  /** A Mac daemon: the account's plist rewritten to run `vespin-host`, where it runs the release's `luke-host`. */
  const launchAgentRewritten = Effect.gen(function* () {
    const plist = path.join(home, ...ACCOUNT.LAUNCH_AGENTS, `${HOST_SERVICE.LAUNCH_AGENT}.plist`);
    const standing = yield* Effect.option(fileSystem.readFileString(plist));
    const before = `<string>${path.join(releases, ...COMMAND.BEFORE_RENAME)}</string>`;
    if (!Option.exists(standing, (text) => text.includes(before))) return;
    const log = path.join(home, ...ACCOUNT.LOG);
    yield* fileSystem
      .makeDirectory(path.dirname(log), { recursive: true })
      .pipe(Effect.mapError(() => `${path.dirname(log)} could not be made`));
    yield* written(plist, launchAgentText(command, log));
    report(
      `${PRODUCT_NAME} host: its LaunchAgent runs vespin-host from the next time launchd loads it.`,
    );
  });

  yield* linked.pipe(Effect.catch(failed));
  switch (service) {
    case HOST_SERVICE.UNIT_BEFORE_RENAME:
      return yield* unitMoved.pipe(
        Effect.catch((reason) => Effect.as(failed(reason), HOST_SERVICE_MOVE.STAYS)),
      );
    case HOST_SERVICE.UNIT:
      yield* leftRetired.pipe(Effect.catch(failed));
      return HOST_SERVICE_MOVE.STAYS;
    case HOST_SERVICE.LAUNCH_AGENT:
      yield* launchAgentRewritten.pipe(Effect.catch(failed));
      return HOST_SERVICE_MOVE.STAYS;
  }
});
