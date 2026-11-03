/**
 * main.ts -- the host daemon's process: `vespin-host run` follows the machine's local agents for as long as its service runs, `vespin-host connect` pairs the machine with a code a member approves in the app, and `vespin-host version` prints the daemon's version.
 *
 * Bundled into one file (`pnpm --filter @luke/host-daemon build`) that the
 * host's release carries at `lib/vespin-host.mjs`, beside the runner's bundle
 * at `lib/agent-runner.mjs` (`host-platform.ts`), and runs on the release's
 * own Node. The same bundle runs on every OS, as `process.platform` says
 * (`hostRuntime`). The account install (`apps/web/install/install.sh`)
 * runs it as the account it is installed in, on Linux and on a Mac alike:
 * each release unpacked under `~/.local/share/luke-host/versions/<version>`,
 * `current` beside them linking to the one that runs, its state under
 * `~/.local/state/luke-host`, which the release's `vespin-host` names
 * (`vespin-host.sh`), and a systemd user unit or a LaunchAgent running `run`
 * through `current`, and again a minute after any exit. This Mac's host is
 * that same install, which the desktop app starts and stops through launchd
 * (`apps/desktop/src/main/native/host-login-item.ts`).
 *
 * `run` is the command the service runs. A daemon the account install's
 * service started first moves that service over to `vespin-host` where a
 * release before the rename wrote it (`hostServiceMoved`), and where it
 * handed the host over to the new unit, follows nothing while systemd stops
 * its own. A box that never connected says
 * so and reads its record again every `UNENROLLED_REST`, rather than
 * exiting for its service to start it over; one that did runs the daemon
 * (`@luke/host/daemon`) until the service is stopped, which stops every
 * runner it started with it, or until the service refuses the box's secret, the
 * host removed, when it stops them and exits 0, and its service, starting
 * it again a minute later, finds its record refused and rests, until the
 * box is connected again by hand. A daemon the account install runs, its
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
 * `connect` is run as the box is set up or by hand: it prints the link and
 * the code a member approves in the app, waits for them to, and exits by how
 * the connect ended (`CONNECT_EXIT`), never printing the poll secret or the
 * device secret. A box already connected
 * says so and pairs nothing. Ctrl-C ends the wait with a line saying the
 * box was not connected.
 */

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
import { HOST_COMMAND, HOST_WIRE, hostInstallCommand } from "@luke/features/host-wire";
import { LINK_ORIGIN } from "@luke/features/link-home";
import { PRODUCT_NAME } from "@luke/features/product-name";
import {
  connectHostDevice,
  HOST_CONNECT_OUTCOME,
  HOST_DAEMON_END,
  HOST_SERVICE,
  HOST_SERVICE_MOVE,
  type HostPairingCode,
  type HostReleases,
  type HostRuntime,
  type HostService,
  hostArch,
  hostDaemon,
  hostPlatform,
  hostRuntime,
  hostServiceMoved,
  hostServiceOf,
  LINUX_HOST,
  readHostDevice,
} from "@luke/host/daemon";
import { Environment, reporterLayer } from "@luke/host/effect";
import { reportToStderr } from "@luke/host/node";
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

/** How long a box that never connected rests before it reads its record again. */
const UNENROLLED_REST = Duration.minutes(1);

/** Where the account install keeps its releases, under the home it is installed in, each in a folder of its own under `versions/` (`vespin-host.sh`'s `ACCOUNT_RELEASES`). */
const ACCOUNT_RELEASES = { FOLDER: ".local/share/luke-host", VERSIONS: "versions" } as const;

/** The file the kernel names this process's control groups in, a systemd unit's own among them. */
const CGROUP_FILE = "/proc/self/cgroup";

/** How long systemd may take to take the ask to start the daemon again. */
const RESTART_ASK = Duration.seconds(10);

/** How long a daemon that handed the host over to the new unit waits for systemd to stop it before it follows after all, which the follower lease keeps from running beside the new unit's daemon. */
const HANDED_OVER_WAIT = Duration.minutes(1);

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

const COMMAND = { RUN: "run", CONNECT: "connect", VERSION: "version" } as const;

/** The release's own folder: this bundle stands in its `lib/`. */
const installFolder = path.resolve(path.dirname(process.argv[1] ?? "."), "..");

/**
 * The account install's releases, where this release's own real path
 * stands in a version folder of them, as `vespin-host.sh`'s `account_home`
 * reads it; none for a development run and an install that came before,
 * neither of which updates itself.
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
 * where its state lives, under the home its service hands it: the
 * `luke-host` user's from systemd, the member's from launchd.
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

/** The daemon on the box's record, or a rest until there is one; it ends once the service refuses the box's secret, or the daemon switched to a newer release. */
const follow = (runtime: HostRuntime) =>
  Effect.gen(function* () {
    const { stateRoot } = runtime;
    const device = yield* readHostDevice(stateRoot);
    if (Option.isNone(device)) {
      reportToStderr(
        `${PRODUCT_NAME} host: this box is not connected. Run ${HOST_COMMAND} connect, or the install command from Settings › Hosts › Add hosts (${DEFAULT_INSTALL_COMMAND}), and approve the code it shows in ${PRODUCT_NAME}.`,
      );
      yield* Effect.sleep(UNENROLLED_REST);
      return undefined;
    }
    // Note that a box the service refused before is not asked again on the dead secret: it rests removed until it is connected again.
    if (device.value.refused === true) {
      reportToStderr(
        `${PRODUCT_NAME} host: ${PRODUCT_NAME} refused this box's secret before, so it was removed. Connect it again to follow its agents.`,
      );
      return HOST_DAEMON_END.REMOVED;
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
      reportToStderr(
        `${PRODUCT_NAME} host: every agent it ran is stopped. It exits until this box is connected again.`,
      );
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

/** The account install's service moved over to `vespin-host`, where this daemon is that install's and its service started it; how the move ended. */
const serviceMoved = (service: HostService | undefined) =>
  Effect.suspend(() => {
    const releases = accountReleases();
    if (releases === undefined || service === undefined) {
      return Effect.succeed(HOST_SERVICE_MOVE.STAYS);
    }
    return hostServiceMoved({
      service,
      home: releases.folder.slice(0, -ACCOUNT_RELEASES.FOLDER.length - 1),
      releases: releases.folder,
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
  service !== HOST_SERVICE.UNIT && service !== HOST_SERVICE.UNIT_BEFORE_RENAME
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

/** `vespin-host run`: the service moved over, then the daemon, until the service refuses the box's secret, or until it switched to a newer release, which its service is asked to start at once. */
const run = (runtime: HostRuntime) =>
  Effect.gen(function* () {
    const service = yield* serviceRunning(runtime);
    if ((yield* serviceMoved(service)) === HOST_SERVICE_MOVE.HANDED_OVER) {
      yield* Effect.sleep(HANDED_OVER_WAIT);
    }
    const ended = yield* follow(runtime);
    if (ended === HOST_DAEMON_END.UPDATED) yield* restartAsked(service);
    return 0;
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
