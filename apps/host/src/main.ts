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

const VERSION = process.env.APP_HOST_VERSION ?? "0.0.0";

const DEFAULT_SERVICE_ORIGIN = LINK_ORIGIN;

const DEFAULT_INSTALL_COMMAND = hostInstallCommand(
  new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, DEFAULT_SERVICE_ORIGIN).href,
);

const UNENROLLED_REST = Duration.minutes(1);

const ACCOUNT_RELEASES = { FOLDER: ".local/share/vespin-host", VERSIONS: "versions" } as const;

const CGROUP_FILE = "/proc/self/cgroup";

const RESTART_ASK = Duration.seconds(10);

const CONNECT_EXIT = {
  CONNECTED: 0,
  FAILED: 1,
  DENIED: 2,
  EXPIRED: 3,
  UPGRADE_NEEDED: 4,
  BRAKED: 5,
  USAGE: 64,
} as const;

const LEAVE_EXIT = { LEFT: 0, UNANSWERED: 1 } as const;

const RELEASE_COMMAND = "bin/vespin-host";

const UNINSTALL_UNIT = "vespin-host-uninstall";

const COMMAND = { RUN: "run", CONNECT: "connect", LEAVE: "leave", VERSION: "version" } as const;

const installFolder = path.resolve(path.dirname(process.argv[1] ?? "."), "..");

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

const runtimeOfOs = hostRuntime({
  platform: process.platform,
  home: process.env.HOME ?? os.homedir(),
});

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

const arch = ({ os: hostOs }: HostRuntime) =>
  Effect.suspend(() => {
    const read = hostArch(hostOs, process.arch);
    return read === undefined
      ? Effect.fail(
          `${PRODUCT_NAME} host runs on ${hostOs.arches.join(" and ")} ${hostOs.name}, not ${process.arch}.`,
        )
      : Effect.succeed(read);
  });

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
      return accountReleases() === undefined ? undefined : ended;
    }
    return ended;
  }).pipe(Effect.repeat({ until: (ended) => ended !== undefined }));

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

const run = (runtime: HostRuntime) =>
  Effect.gen(function* () {
    const service = yield* serviceRunning(runtime);
    const ended = yield* follow(runtime);
    if (ended === HOST_DAEMON_END.UPDATED) yield* restartAsked(service);
    if (ended === HOST_DAEMON_END.REMOVED) yield* removeItself(service);
    return 0;
  });

const leave = (runtime: HostRuntime) =>
  Effect.map(leaveHostDevice({ stateRoot: runtime.stateRoot, version: VERSION }), (outcome) => {
    if (outcome !== HOST_LEAVE_OUTCOME.UNANSWERED) return LEAVE_EXIT.LEFT;
    process.stderr.write(`Could not reach ${PRODUCT_NAME} to remove this box from it.\n`);
    return LEAVE_EXIT.UNANSWERED;
  });

function connectCommand(origin: string): string {
  return origin === DEFAULT_SERVICE_ORIGIN
    ? `${HOST_COMMAND} connect`
    : `${HOST_COMMAND} connect --origin ${origin}`;
}

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

type HostServices = Layer.Success<typeof nodeServices>;

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
