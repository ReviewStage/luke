/**
 * main.ts -- the host daemon's process: `vespin-host run` follows the machine's local agents for as long as its service runs, `vespin-host connect` pairs the machine with a code a member approves in the app, and `vespin-host version` prints the daemon's version.
 *
 * Bundled into one file (`pnpm --filter @repo/host-daemon build`) that the
 * host's release carries at `lib/vespin-host.mjs`, beside the runner's bundle
 * at `lib/agent-runner.mjs` (`host-platform.ts`), and runs on the release's
 * own Node. The same bundle runs on every OS, as `process.platform` says
 * (`hostRuntime`). The account install (`apps/web/install/install.sh`)
 * runs it as the account it is installed in, on Linux and on a Mac alike:
 * each release unpacked under `~/.local/share/vespin-host/versions/<version>`,
 * `current` beside them linking to the one that runs, its state under
 * `~/.local/state/vespin-host`, which the release's `vespin-host` names
 * (`vespin-host.sh`), and a systemd user unit or a LaunchAgent running `run`
 * through `current`, and again a minute after any exit. This Mac's host is
 * that same install, which the desktop app starts and stops through launchd
 * (`apps/desktop/src/main/native/this-mac-host.ts`).
 *
 * `run` is the command the service runs. A box that never connected says
 * so and watches its state folder until a connect writes its record
 * (`hostDeviceWhen`), rather than exiting for its service to start it
 * over; one that did runs the daemon
 * (`@repo/host/daemon`) until the service is stopped, which stops every
 * runner it started with it. Once the service settles the box's secret as
 * refused, the host removed in Settings › Hosts, it stops them and marks its
 * record refused; the account install then removes itself, as `vespin-host
 * uninstall` does, run apart from its own service (`removeItself`), and any
 * other run rests (`hostRefusedRest`) until the box is connected again. A
 * start on a refused record rests the same way, never removing anything,
 * since the install script starts the service before it connects the box
 * again. A daemon the account install runs, its
 * own real path in a version folder of the install's releases
 * (`accountReleases`), updates itself to the newer release the service names
 * (`host-update.ts`): once it switched `current` to it, every runner
 * stopped, it asks a systemd user unit to start it again at once, since
 * the unit's own restart waits a minute, or on a Mac just exits, since
 * launchd's minute counts from the last start; one run by hand just exits.
 * Every agent runs straight
 * on the box (`hostPlatform`), as a child of this process, on its Node,
 * and as its user.
 *
 * `leave` removes the box from its account on its own secret, which
 * `vespin-host uninstall` runs before it deletes that secret
 * (`@repo/host/daemon`'s `leaveHostDevice`), and exits by whether the
 * service took it (`LEAVE_EXIT`).
 *
 * `connect` is run as the box is set up or by hand: it prints the link and
 * the code a member approves in the app, waits for them to, and exits by how
 * the connect ended (`CONNECT_EXIT`), never printing the poll secret or the
 * device secret. A box already connected
 * says so and pairs nothing. Ctrl-C ends the wait with a line saying the
 * box was not connected.
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { HOST_COMMAND, HOST_WIRE, hostInstallCommand } from "@repo/features/host-wire";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  connectHostDevice,
  HOST_CONNECT_OUTCOME,
  HOST_DAEMON_END,
  HOST_LEAVE_OUTCOME,
  HOST_SERVICE,
  type HostPairingCode,
  type HostReleases,
  type HostRuntime,
  type HostService,
  hostArch,
  hostDaemon,
  hostDeviceWhen,
  hostPlatform,
  hostRefusedRest,
  hostRuntime,
  hostServiceOf,
  LINUX_HOST,
  leaveHostDevice,
  readHostDevice,
} from "@repo/host/daemon";
import { Environment, reporterLayer } from "@repo/host/effect";
import { reportToStderr } from "@repo/host/node";
import { ConfigProvider, Duration, Effect, Exit, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { ChildProcess } from "effect/process";

/** The daemon's version, which the release's build writes in; a development run is below every floor. */
const VERSION = process.env.APP_HOST_VERSION ?? "0.0.0";

/** The service a box connects to where its install script names none. */
const DEFAULT_SERVICE_ORIGIN = LINK_ORIGIN;

/** The public command that installs the host program and connects the box to that service. */
const DEFAULT_INSTALL_COMMAND = hostInstallCommand(
  new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, DEFAULT_SERVICE_ORIGIN).href,
);

/** Where the account install keeps its releases, under the home it is installed in, each in a folder of its own under `versions/` (`vespin-host.sh`'s `ACCOUNT_RELEASES`). */
const ACCOUNT_RELEASES = { FOLDER: ".local/share/vespin-host", VERSIONS: "versions" } as const;

/** The file the kernel names this process's control groups in, a systemd unit's own among them. */
const CGROUP_FILE = "/proc/self/cgroup";

/** How long systemd may take to take the ask to start the daemon again. */
const RESTART_ASK = Duration.seconds(10);

/** The exit codes of `connect`, which the install script reads: a box already connected exits as connected. */
const CONNECT_EXIT = {
  CONNECTED: 0,
  /** The service could not be reached, or refused the pairing for a reason the box cannot fix. */
  FAILED: 1,
  DENIED: 2,
  EXPIRED: 3,
  UPGRADE_NEEDED: 4,
  /** The service is starting no more pairings from the box's address for now. */
  BRAKED: 5,
  USAGE: 64,
} as const;

/** The exit codes of `leave`, which `vespin-host uninstall` reads: a box that never joined has nothing to leave. */
const LEAVE_EXIT = { LEFT: 0, UNANSWERED: 1 } as const;

/** The release's command, beside its `lib/`, whose `uninstall` removes the account install (`vespin-host.sh`). */
const RELEASE_COMMAND = "bin/vespin-host";

/** The transient systemd unit a removed box's uninstall runs in, apart from the daemon's own unit, which it stops. */
const UNINSTALL_UNIT = "vespin-host-uninstall";

const COMMAND = { RUN: "run", CONNECT: "connect", LEAVE: "leave", VERSION: "version" } as const;

/** The release's own folder: this bundle stands in its `lib/`. */
const installFolder = path.resolve(path.dirname(process.argv[1] ?? "."), "..");

/**
 * The account install's releases, where this release's own real path
 * stands in a version folder of them, as `vespin-host.sh`'s `account_home`
 * reads it; none for a development run, which does not update itself.
 */
function accountReleases(): HostReleases | undefined {
  let real: string;
  try {
    real = realpathSync(installFolder);
  } catch {
    return undefined;
  }
  const versions = path.dirname(real);
  const folder = path.dirname(versions);
  if (
    path.basename(versions) !== ACCOUNT_RELEASES.VERSIONS ||
    !folder.endsWith(`/${ACCOUNT_RELEASES.FOLDER}`)
  ) {
    return undefined;
  }
  return { folder, running: path.basename(real) };
}

/**
 * The OS this bundle runs on, what the daemon does differently there, and
 * where its state lives, under the home its service hands it.
 */
const runtimeOfOs = hostRuntime({
  platform: process.platform,
  home: process.env.HOME ?? os.homedir(),
});

/**
 * The runtime the daemon runs as, its state folder named by
 * `APP_HOST_STATE_ROOT` where the release's `vespin-host` names it
 * (`vespin-host.sh`, for the account install), so a command run by hand reads
 * and writes the record its service runs on.
 */
const runtime: HostRuntime | undefined =
  runtimeOfOs === undefined || process.env.APP_HOST_STATE_ROOT === undefined
    ? runtimeOfOs
    : { ...runtimeOfOs, stateRoot: process.env.APP_HOST_STATE_ROOT };

const nodeServices = Layer.mergeAll(
  NodeChildProcessSpawner.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  ),
  FetchHttpClient.layer,
  reporterLayer(reportToStderr),
  Layer.succeed(Environment, ConfigProvider.fromEnv()),
);

/** The machine's architecture, or a failure naming it where no release for its OS is built for it. */
const arch = ({ os: hostOs }: HostRuntime) =>
  Effect.suspend(() => {
    const read = hostArch(hostOs, process.arch);
    return read === undefined
      ? Effect.fail(
          `${PRODUCT_NAME} host runs on ${hostOs.arches.join(" and ")} ${hostOs.name}, not ${process.arch}.`,
        )
      : Effect.succeed(read);
  });

/** The daemon on the box's record, a wait until a connect writes one, or a rest while the service refuses it; it ends once the daemon switched to a newer release. */
const follow = (runtime: HostRuntime) =>
  Effect.gen(function* () {
    const { stateRoot } = runtime;
    const device = yield* readHostDevice(stateRoot);
    if (Option.isNone(device)) {
      reportToStderr(
        `${PRODUCT_NAME} host: this box is not connected. Run ${HOST_COMMAND} connect, or the install command from Settings › Hosts › Add hosts (${DEFAULT_INSTALL_COMMAND}), and approve the code it shows in ${PRODUCT_NAME}.`,
      );
      yield* hostDeviceWhen(stateRoot, Option.isSome);
      return undefined;
    }
    // Note that a box the service refused rests until it is connected again.
    if (device.value.refused === true) {
      yield* hostRefusedRest({ stateRoot, device: device.value });
      return undefined;
    }
    const boxArch = yield* arch(runtime);
    const platform = hostPlatform({
      os: runtime.os,
      installFolder,
      arch: boxArch,
      stateRoot,
      node: process.execPath,
      // Note that every agent runs as the daemon's user, the member's own or root on a dedicated box.
      user: { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 },
    });
    reportToStderr(
      `${PRODUCT_NAME} host ${VERSION}: following ${device.value.serviceOrigin} as ${platform.deviceName}.`,
    );
    const ended = yield* hostDaemon({
      stateRoot,
      device: device.value,
      version: VERSION,
      platform,
      releases: accountReleases(),
    });
    if (ended === HOST_DAEMON_END.REMOVED) {
      reportToStderr(`${PRODUCT_NAME} host: every agent it ran is stopped.`);
      // Note that only the account install removes itself, since a run of any other build has no install to remove, and rests as a refused box does.
      return accountReleases() === undefined ? undefined : ended;
    }
    return ended;
  }).pipe(Effect.repeat({ until: (ended) => ended !== undefined }));

/**
 * The service of ours that runs this daemon (`hostServiceOf`), as its
 * service manager hands it over: the control group a systemd unit runs it
 * in, or the label launchd names its job by.
 */
const serviceRunning = (runtime: HostRuntime) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cgroup =
      runtime.os.platform === LINUX_HOST.platform
        ? yield* fileSystem.readFileString(CGROUP_FILE).pipe(Effect.orElseSucceed(() => ""))
        : "";
    return hostServiceOf({
      platform: runtime.os.platform,
      cgroup,
      launchdLabel: process.env.XPC_SERVICE_NAME,
    });
  });

/**
 * The daemon's service asked to start it again at once on the release
 * `current` now names: the systemd user unit it runs under restarted
 * without waiting out the minute its own restart waits, while a Mac's
 * LaunchAgent needs no ask, since launchd's minute counts from the daemon's
 * last start, and a run by hand has no service to ask. An ask that fails is
 * said, and the exit leaves the start to the unit's own restart.
 */
const restartAsked = (service: HostService | undefined) =>
  service !== HOST_SERVICE.UNIT
    ? Effect.void
    : Effect.scoped(
        Effect.flatMap(
          ChildProcess.make("systemctl", ["--user", "restart", "--no-block", service], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          }),
          (handle) => handle.exitCode,
        ),
      ).pipe(
        Effect.timeoutOption(RESTART_ASK),
        Effect.map(Option.exists((code) => Number(code) === 0)),
        Effect.orElseSucceed(() => false),
        Effect.flatMap((asked) =>
          asked
            ? Effect.void
            : Effect.sync(() =>
                reportToStderr(
                  `${PRODUCT_NAME} host: systemd did not take the ask to restart ${service}, so it starts on the new release within a minute.`,
                ),
              ),
        ),
      );

/**
 * The account install's `uninstall` started apart from the daemon, so that
 * stopping the daemon's service, its first step, does not stop it too: in a
 * transient systemd unit of its own beside a unit, which a stop of the
 * unit's control group does not reach, and otherwise in a session of its
 * own, its words in the daemon's own log. Its input is no terminal, so it
 * asks nothing and removes every agent's folder. Whether it started.
 */
const uninstallApart = (service: HostService | undefined) => {
  const command = path.join(installFolder, RELEASE_COMMAND);
  if (service === HOST_SERVICE.UNIT) {
    return Effect.scoped(
      Effect.flatMap(
        ChildProcess.make(
          "systemd-run",
          ["--user", "--collect", "--quiet", "--unit", UNINSTALL_UNIT, command, "uninstall"],
          { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
        ),
        (handle) => handle.exitCode,
      ),
    ).pipe(
      Effect.map((code) => Number(code) === 0),
      Effect.orElseSucceed(() => false),
    );
  }
  // Note that a command that cannot start fails as an `error` event after the spawn returns, so the answer waits on `spawn` or `error`, whichever comes first.
  return Effect.callback<boolean>((resume) => {
    try {
      const child = spawn(command, ["uninstall"], {
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.once("spawn", () => {
        child.unref();
        resume(Effect.succeed(true));
      });
      child.once("error", () => resume(Effect.succeed(false)));
    } catch {
      resume(Effect.succeed(false));
    }
  });
};

/**
 * A box removed in Settings › Hosts removing itself, as `vespin-host
 * uninstall` would: its service, its agents' folders, its state and its
 * releases. The daemon exits once the uninstall has started, since the
 * uninstall stops its service within moments; one that did not start is
 * said, and a start of the service meanwhile rests on its refused record.
 */
const removeItself = (service: HostService | undefined) =>
  Effect.gen(function* () {
    reportToStderr(
      `${PRODUCT_NAME} host: removed in Settings › Hosts, so it removes itself from this account: its service, its agents' folders, its state and its releases.`,
    );
    if (!(yield* uninstallApart(service))) {
      reportToStderr(
        `${PRODUCT_NAME} host: could not start its uninstall. Run ${HOST_COMMAND} uninstall to remove it.`,
      );
    }
  });

/** `vespin-host run`: the daemon, resting while the service refuses the box's secret, until it switched to a newer release, which its service is asked to start at once, or the box was removed, which it removes itself from. */
const run = (runtime: HostRuntime) =>
  Effect.gen(function* () {
    const service = yield* serviceRunning(runtime);
    const ended = yield* follow(runtime);
    if (ended === HOST_DAEMON_END.UPDATED) yield* restartAsked(service);
    if (ended === HOST_DAEMON_END.REMOVED) yield* removeItself(service);
    return 0;
  });

/** `vespin-host leave`: the box removed from its account on its own secret, as `vespin-host uninstall` asks before it deletes that secret; only a call the service did not take is said, since the uninstall says the rest. */
const leave = (runtime: HostRuntime) =>
  Effect.map(leaveHostDevice({ stateRoot: runtime.stateRoot, version: VERSION }), (outcome) => {
    if (outcome !== HOST_LEAVE_OUTCOME.UNANSWERED) return LEAVE_EXIT.LEFT;
    process.stderr.write(`Could not reach ${PRODUCT_NAME} to remove this box from it.\n`);
    return LEAVE_EXIT.UNANSWERED;
  });

/** The command that connects this box to the service given: its origin named where it is not the one `connect` takes by default. */
function connectCommand(origin: string): string {
  return origin === DEFAULT_SERVICE_ORIGIN
    ? `${HOST_COMMAND} connect`
    : `${HOST_COMMAND} connect --origin ${origin}`;
}

/** How the code is shown: its link to open and the code to check against the one the app shows, then that the box waits. */
const showCode = ({ url, userCode, expiresInMs }: HostPairingCode) =>
  Effect.sync(() =>
    process.stdout.write(
      [
        `To connect this box to ${PRODUCT_NAME}, open this link and approve the code:`,
        "",
        `  ${url}`,
        "",
        `  Code: ${userCode}`,
        "",
        `Waiting for approval. The code lasts ${Math.round(expiresInMs / 60_000)} minutes; Ctrl-C stops waiting.`,
        "",
      ].join("\n"),
    ),
  );

/** `vespin-host connect`: the box paired with a code a member approves, and the line that says how it ended. */
const connect = (runtime: HostRuntime, name: string, origin: string) =>
  Effect.gen(function* () {
    const outcome = yield* connectHostDevice({
      stateRoot: runtime.stateRoot,
      serviceOrigin: origin,
      name,
      platform: runtime.os.platform,
      arch: yield* arch(runtime),
      machine: runtime.os.machine(),
      version: VERSION,
      shown: showCode,
    });
    switch (outcome.outcome) {
      case HOST_CONNECT_OUTCOME.CONNECTED:
        process.stdout.write(
          `Connected as ${name} (secret kept readable by ${os.userInfo().username} only)\n`,
        );
        return CONNECT_EXIT.CONNECTED;
      case HOST_CONNECT_OUTCOME.ALREADY_CONNECTED:
        process.stdout.write(
          `This box is already connected to ${outcome.serviceOrigin}, so nothing was changed.\n`,
        );
        return CONNECT_EXIT.CONNECTED;
      case HOST_CONNECT_OUTCOME.DENIED:
        process.stderr.write(
          `The code was denied in ${PRODUCT_NAME}, so this box was not connected. Run ${connectCommand(origin)} again for a new code.\n`,
        );
        return CONNECT_EXIT.DENIED;
      case HOST_CONNECT_OUTCOME.EXPIRED:
        process.stderr.write(
          `The code expired before it was approved, so this box was not connected. Run ${connectCommand(origin)} again for a new code.\n`,
        );
        return CONNECT_EXIT.EXPIRED;
      case HOST_CONNECT_OUTCOME.BRAKED:
        process.stderr.write(
          `${PRODUCT_NAME} is taking no more connections from this address for now. Wait a few minutes, then run ${connectCommand(origin)} again.\n`,
        );
        return CONNECT_EXIT.BRAKED;
      case HOST_CONNECT_OUTCOME.UPGRADE_NEEDED:
        process.stderr.write(
          `${PRODUCT_NAME} needs a newer host than ${VERSION}${outcome.minimumVersion === undefined ? "" : ` (${outcome.minimumVersion} or later)`}. Run the install command again to fetch it.\n`,
        );
        return CONNECT_EXIT.UPGRADE_NEEDED;
      case HOST_CONNECT_OUTCOME.REFUSED:
        process.stderr.write(`${PRODUCT_NAME} at ${origin} refused to pair this box.\n`);
        return CONNECT_EXIT.FAILED;
      case HOST_CONNECT_OUTCOME.UNANSWERED:
        process.stderr.write(`Could not reach ${PRODUCT_NAME} at ${origin}.\n`);
        return CONNECT_EXIT.FAILED;
    }
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => process.stderr.write("\nStopped, so this box was not connected.\n")),
    ),
  );

/** The services every command runs on, which `nodeServices` provides. */
type HostServices = Layer.Success<typeof nodeServices>;

/** The command the process was started with, as the exit code it ends with. */
function main(argv: readonly string[]): Effect.Effect<number, unknown, HostServices> {
  const [command, ...rest] = argv;
  if (command === COMMAND.VERSION) {
    return Effect.sync(() => process.stdout.write(`${VERSION}\n`)).pipe(Effect.as(0));
  }
  if (runtime === undefined) {
    return Effect.sync(() =>
      process.stderr.write(
        `${PRODUCT_NAME} host runs on Linux and macOS, not ${process.platform}.\n`,
      ),
    ).pipe(Effect.as(1));
  }
  if (command === COMMAND.RUN) return run(runtime);
  if (command === COMMAND.LEAVE) return leave(runtime);
  if (command === COMMAND.CONNECT) {
    const { values } = parseArgs({
      args: [...rest],
      options: { name: { type: "string" }, origin: { type: "string" } },
    });
    const name = values.name ?? runtime.os.deviceName();
    if (name.length === 0) {
      return Effect.sync(() => process.stderr.write("vespin-host connect needs a --name\n")).pipe(
        Effect.as(CONNECT_EXIT.USAGE),
      );
    }
    return connect(runtime, name, (values.origin ?? DEFAULT_SERVICE_ORIGIN).replace(/\/+$/u, ""));
  }
  return Effect.sync(() =>
    process.stderr.write(
      "usage: vespin-host run | connect [--origin <url>] [--name <name>] | version | uninstall\n",
    ),
  ).pipe(Effect.as(CONNECT_EXIT.USAGE));
}

NodeRuntime.runMain(
  main(process.argv.slice(2)).pipe(
    Effect.catch((failure) =>
      Effect.sync(() => process.stderr.write(`${PRODUCT_NAME} host: ${String(failure)}\n`)).pipe(
        Effect.as(1),
      ),
    ),
    Effect.provide(nodeServices),
  ),
  { teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : 1) },
);
