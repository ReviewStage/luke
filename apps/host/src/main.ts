/**
 * main.ts -- the host daemon's process: `luke-host run` follows the machine's local agents for as long as its service runs, `luke-host connect` pairs the machine with a code a member approves in Luke, `luke-host enroll` trades an install token for the machine's device secret, and `luke-host version` prints the daemon's version.
 *
 * Bundled into one file (`pnpm --filter @luke/host-daemon build`) that the
 * host's release carries at `lib/luke-host.mjs`, beside the runner's bundle
 * at `lib/agent-runner.mjs` (`host-platform.ts`), and runs on the release's
 * own Node. The same bundle runs on every OS, as `process.platform` says
 * (`hostRuntime`). On Linux every command runs as the `luke-host` user,
 * whose home holds the daemon's state, `state/` under it, and the box's
 * systemd service runs `run`. On a Mac the release is a folder inside the
 * desktop app (`Contents/Resources/luke-host`), every command runs as the
 * member, whose app's own state folder is the daemon's, and the app's login
 * item runs `run` (`apps/desktop/native/macos/HostLoginItem.swift`).
 *
 * `run` is the command the box's system service runs. A box
 * that never enrolled says so and reads its record again every
 * `UNENROLLED_REST`, rather than exiting for systemd to start it over; one
 * that did runs the daemon (`@luke/host/daemon`) until the service is
 * stopped, which stops every runner it started with it, or until Luke
 * refuses the box's secret, the host removed, when it stops them and exits 0,
 * which the service's `Restart=on-failure` leaves stopped. Every agent runs
 * straight on the box (`hostPlatform`), as a child of this process, on its
 * Node, and as its user, so a box needs neither smolvm nor KVM. The `smolvm`
 * its agents ran their VMs in before, where the install script put one at
 * the path its service names (`LINUX_HOST`'s `smolvm`), or the pinned
 * release a Mac fetched under its state (`DARWIN_HOST`'s), is handed on
 * unasked (`hostSmolvmLeft`), only to delete what those VMs left standing.
 *
 * `enroll` is run once as the box is set up: it reads the install token on stdin,
 * where `--token` gives none, prints the one line the script shows, and
 * exits by how the enroll ended (`ENROLL_EXIT`), never printing the token or
 * the secret.
 *
 * `connect` is the enroll's successor, run as the box is set up or by hand:
 * it prints the link and the code a member approves in Luke, waits for
 * them to, and exits by how the connect ended (`CONNECT_EXIT`), never
 * printing the poll secret or the device secret. A box already connected
 * says so and pairs nothing. Ctrl-C ends the wait with a line saying the
 * box was not connected.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { HOST_ENROLL_OUTCOME } from "@luke/features";
import { buildCarriesDeveloperIdSigning } from "@luke/host/app-identity";
import {
  connectHostDevice,
  enrollHostDevice,
  HOST_CONNECT_OUTCOME,
  type HostPairingCode,
  type HostPlatformOptions,
  type HostRuntime,
  hostArch,
  hostDaemon,
  hostPlatform,
  hostRuntime,
  hostSmolvmLeft,
  readHostDevice,
} from "@luke/host/daemon";
import { Environment, reporterLayer } from "@luke/host/effect";
import { reportToStderr } from "@luke/host/node";
import { ConfigProvider, Duration, Effect, Exit, Layer, Option } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

/** The daemon's version, which the release's build writes in; a development run is below every floor. */
const VERSION = process.env.LUKE_HOST_VERSION ?? "0.0.0";

/** The service a box enrolls with where its install script names none. */
const DEFAULT_SERVICE_ORIGIN = "https://tryluke.dev";

/** How long a box that never enrolled rests before it reads its record again. */
const UNENROLLED_REST = Duration.minutes(1);

/** The exit codes of `enroll`, which the install script reads. */
const ENROLL_EXIT = {
  ENROLLED: 0,
  UNANSWERED: 1,
  REFUSED: 2,
  UPGRADE_NEEDED: 3,
  USAGE: 64,
} as const;

/** The exit codes of `connect`, which the install script reads: a box already connected exits as connected. */
const CONNECT_EXIT = {
  CONNECTED: 0,
  /** Luke could not be reached, or refused the pairing for a reason the box cannot fix. */
  FAILED: 1,
  DENIED: 2,
  EXPIRED: 3,
  UPGRADE_NEEDED: 4,
  /** Luke is starting no more pairings from the box's address for now. */
  BRAKED: 5,
  USAGE: 64,
} as const;

const COMMAND = { RUN: "run", CONNECT: "connect", ENROLL: "enroll", VERSION: "version" } as const;

/** The release's own folder: this bundle stands in its `lib/`. */
const installFolder = path.resolve(path.dirname(process.argv[1] ?? "."), "..");

/**
 * The OS this bundle runs on, what the daemon does differently there, and
 * where its state lives, under the home its service hands it: the
 * `luke-host` user's from systemd, the member's from launchd.
 */
const runtimeOfOs = hostRuntime({
  platform: process.platform,
  home: process.env.HOME ?? os.homedir(),
  app: { developerIdSigned: buildCarriesDeveloperIdSigning() },
});

/**
 * The runtime the daemon runs as, its state folder named by
 * `LUKE_HOST_STATE_ROOT` where a development build of the desktop app runs
 * it as a child (`apps/desktop/src/main/native/host-login-item.ts`), since
 * that build's own state folder is not the one a packaged app's is.
 */
const runtime: HostRuntime | undefined =
  runtimeOfOs === undefined || process.env.LUKE_HOST_STATE_ROOT === undefined
    ? runtimeOfOs
    : { ...runtimeOfOs, stateRoot: process.env.LUKE_HOST_STATE_ROOT };

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
          `Luke host runs on ${hostOs.arches.join(" and ")} ${hostOs.name}, not ${process.arch}.`,
        )
      : Effect.succeed(read);
  });

/** The daemon on the box's record, or a rest until there is one, the VMs its agents left from before deleted by the `smolvm` given; it ends once Luke refuses the box's secret. */
const follow = (runtime: HostRuntime, smolvm: HostPlatformOptions["smolvm"]) =>
  Effect.gen(function* () {
    const { stateRoot } = runtime;
    const device = yield* readHostDevice(stateRoot);
    if (Option.isNone(device)) {
      reportToStderr(
        "Luke host: this box is not enrolled. Run the install command from Settings › Hosts, with its --token.",
      );
      yield* Effect.sleep(UNENROLLED_REST);
      return false;
    }
    // Note that a box Luke refused before is not asked again on the dead secret: it rests removed until it is enrolled again.
    if (device.value.refused === true) {
      reportToStderr(
        "Luke host: Luke refused this box's secret before, so it was removed. Enroll it again to follow its agents.",
      );
      return true;
    }
    const boxArch = yield* arch(runtime);
    const platform = hostPlatform({
      os: runtime.os,
      installFolder,
      arch: boxArch,
      stateRoot,
      smolvm,
      runnerFolder: process.env.LUKE_HOST_RUNNER_FOLDER,
      node: process.execPath,
      // Note that every agent runs as the daemon's user, the member's own or root on a dedicated box.
      user: { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 },
    });
    reportToStderr(
      `Luke host ${VERSION}: following ${device.value.serviceOrigin} as ${platform.deviceName}.`,
    );
    yield* hostDaemon({ stateRoot, device: device.value, version: VERSION, platform });
    reportToStderr(
      "Luke host: every agent it ran is stopped. It exits until this box is enrolled again.",
    );
    return true;
  }).pipe(Effect.repeat({ until: (removed) => removed }));

/** `luke-host run`: the daemon, until Luke refuses the box's secret. */
const run = (runtime: HostRuntime) =>
  Effect.as(follow(runtime, hostSmolvmLeft(runtime.os.smolvm, process.env)), 0);

/** `luke-host enroll`: the install token traded for the box's secret, and the one line the install script shows. */
const enroll = (runtime: HostRuntime, token: string, name: string, origin: string) =>
  Effect.gen(function* () {
    const outcome = yield* enrollHostDevice({
      stateRoot: runtime.stateRoot,
      serviceOrigin: origin.replace(/\/+$/u, ""),
      installToken: token,
      name,
      platform: runtime.os.platform,
      arch: yield* arch(runtime),
      version: VERSION,
    });
    switch (outcome.outcome) {
      case HOST_ENROLL_OUTCOME.ENROLLED:
        process.stdout.write(
          `Enrolled as ${name} (secret kept readable by ${os.userInfo().username} only)\n`,
        );
        return ENROLL_EXIT.ENROLLED;
      case HOST_ENROLL_OUTCOME.STILL_ENROLLED:
        process.stdout.write(`Kept this box's enrollment as ${name}\n`);
        return ENROLL_EXIT.ENROLLED;
      case HOST_ENROLL_OUTCOME.REFUSED:
        process.stderr.write(
          "Luke refused the install token: it is unknown, revoked, or past its 24 hours. Copy a fresh command from Settings › Hosts › Add hosts.\n",
        );
        return ENROLL_EXIT.REFUSED;
      case HOST_ENROLL_OUTCOME.UPGRADE_NEEDED:
        process.stderr.write(
          `Luke needs a newer host than ${VERSION}${outcome.minimumVersion === undefined ? "" : ` (${outcome.minimumVersion} or later)`}. Run the install command again to fetch it.\n`,
        );
        return ENROLL_EXIT.UPGRADE_NEEDED;
      case HOST_ENROLL_OUTCOME.UNANSWERED:
        process.stderr.write(`Could not reach Luke at ${origin}.\n`);
        return ENROLL_EXIT.UNANSWERED;
    }
  });

/** How the code is shown: its link to open and the code to check against the one Luke shows, then that the box waits. */
const showCode = ({ url, userCode, expiresInMs }: HostPairingCode) =>
  Effect.sync(() =>
    process.stdout.write(
      [
        "To connect this box to Luke, open this link and approve the code:",
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

/** `luke-host connect`: the box paired with a code a member approves, and the line that says how it ended. */
const connect = (runtime: HostRuntime, name: string, origin: string) =>
  Effect.gen(function* () {
    const outcome = yield* connectHostDevice({
      stateRoot: runtime.stateRoot,
      serviceOrigin: origin,
      name,
      platform: runtime.os.platform,
      arch: yield* arch(runtime),
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
          "The code was denied in Luke, so this box was not connected. Run luke-host connect again for a new code.\n",
        );
        return CONNECT_EXIT.DENIED;
      case HOST_CONNECT_OUTCOME.EXPIRED:
        process.stderr.write(
          "The code expired before it was approved, so this box was not connected. Run luke-host connect again for a new code.\n",
        );
        return CONNECT_EXIT.EXPIRED;
      case HOST_CONNECT_OUTCOME.BRAKED:
        process.stderr.write(
          "Luke is taking no more connections from this address for now. Wait a few minutes, then run luke-host connect again.\n",
        );
        return CONNECT_EXIT.BRAKED;
      case HOST_CONNECT_OUTCOME.UPGRADE_NEEDED:
        process.stderr.write(
          `Luke needs a newer host than ${VERSION}${outcome.minimumVersion === undefined ? "" : ` (${outcome.minimumVersion} or later)`}. Run the install command again to fetch it.\n`,
        );
        return CONNECT_EXIT.UPGRADE_NEEDED;
      case HOST_CONNECT_OUTCOME.REFUSED:
        process.stderr.write(`Luke at ${origin} refused to pair this box.\n`);
        return CONNECT_EXIT.FAILED;
      case HOST_CONNECT_OUTCOME.UNANSWERED:
        process.stderr.write(`Could not reach Luke at ${origin}.\n`);
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
      process.stderr.write(`Luke host runs on Linux and macOS, not ${process.platform}.\n`),
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
      return Effect.sync(() => process.stderr.write("luke-host connect needs a --name\n")).pipe(
        Effect.as(CONNECT_EXIT.USAGE),
      );
    }
    return connect(runtime, name, (values.origin ?? DEFAULT_SERVICE_ORIGIN).replace(/\/+$/u, ""));
  }
  if (command === COMMAND.ENROLL) {
    const { values } = parseArgs({
      args: [...rest],
      options: {
        token: { type: "string" },
        name: { type: "string" },
        origin: { type: "string" },
      },
    });
    // Note that the install script hands the token on stdin, where no other user of the box can read it.
    const token = values.token ?? readFileSync(0, "utf8").trim();
    if (token.length === 0) {
      return Effect.sync(() =>
        process.stderr.write("luke-host enroll needs an install token, as --token or on stdin\n"),
      ).pipe(Effect.as(ENROLL_EXIT.USAGE));
    }
    return enroll(
      runtime,
      token,
      values.name ?? runtime.os.deviceName(),
      values.origin ?? DEFAULT_SERVICE_ORIGIN,
    );
  }
  return Effect.sync(() =>
    process.stderr.write(
      "usage: luke-host run | connect [--origin <url>] [--name <name>] | enroll [--token <token>] | version | uninstall\n",
    ),
  ).pipe(Effect.as(ENROLL_EXIT.USAGE));
}

NodeRuntime.runMain(
  main(process.argv.slice(2)).pipe(
    Effect.catch((failure) =>
      Effect.sync(() => process.stderr.write(`Luke host: ${String(failure)}\n`)).pipe(Effect.as(1)),
    ),
    Effect.provide(nodeServices),
  ),
  { teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : 1) },
);
