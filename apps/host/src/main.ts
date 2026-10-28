/**
 * main.ts -- the host daemon's process: `luke-host run` follows the machine's local agents for as long as its service runs, `luke-host enroll` trades an install token for the machine's device secret, and `luke-host version` prints the daemon's version.
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
 * in a smolvm VM of its own (`hostPlatform`), on the image's own `gh`, with
 * `/dev/kvm` passed through where the box has it, through the `smolvm` the
 * install script put at a fixed path and named in the service's environment
 * (`LINUX_HOST`'s `smolvm`), never the one `PATH` happens to hold, or, on a
 * Mac, the pinned release fetched and checked under its state
 * (`DARWIN_HOST`'s). Before it follows anything on Linux it asks that
 * `smolvm` for its `--version` (`hostSmolvm`) and, where it is not the
 * pinned release, says so and exits `RUN_EXIT.SMOLVM_REFUSED`, which the
 * service's `RestartPreventExitStatus` leaves stopped, since a restart would
 * only repeat the refusal.
 *
 * `enroll` is run once as the box is set up: it reads the install token on stdin,
 * where `--token` gives none, prints the one line the script shows, and
 * exits by how the enroll ended (`ENROLL_EXIT`), never printing the token or
 * the secret.
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
  enrollHostDevice,
  type HostPlatformOptions,
  type HostRuntime,
  hostArch,
  hostDaemon,
  hostPlatform,
  hostRuntime,
  hostSmolvm,
  readHostDevice,
} from "@luke/host/daemon";
import { Environment, reporterLayer } from "@luke/host/effect";
import { reportToStderr } from "@luke/host/node";
import { ConfigProvider, Duration, Effect, Exit, Layer, Option, Result } from "effect";
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

/** The exit codes of `run` that end the service for good: the sysexits `EX_CONFIG`, which the install script's unit names in `RestartPreventExitStatus`. */
const RUN_EXIT = { SMOLVM_REFUSED: 78 } as const;

const COMMAND = { RUN: "run", ENROLL: "enroll", VERSION: "version" } as const;

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

/** The daemon on the box's record, or a rest until there is one, its agents' VMs run by the `smolvm` given; it ends once Luke refuses the box's secret. */
const follow = (runtime: HostRuntime, smolvm: HostPlatformOptions["smolvm"]) =>
  Effect.gen(function* () {
    const { stateRoot } = runtime;
    const device = yield* readHostDevice(stateRoot);
    if (Option.isNone(device)) {
      reportToStderr(
        "Luke host: this box is not enrolled. Run the install command from Settings › Agents › Hosts, with its --token.",
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
      // Note that every command in an agent's VM runs as the daemon's user, luke-host or the member, which owns the agent's folder it mounts.
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

/** `luke-host run`: the daemon, once the machine's `smolvm` is the pinned release; the exit code it ends with otherwise. */
const run = (runtime: HostRuntime) =>
  Effect.gen(function* () {
    const smolvm = yield* hostSmolvm(runtime.os.smolvm, process.env);
    if (Result.isFailure(smolvm)) {
      reportToStderr(smolvm.failure);
      return RUN_EXIT.SMOLVM_REFUSED;
    }
    yield* follow(runtime, smolvm.success);
    return 0;
  });

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
        process.stdout.write(`Kept this box's enrollment as ${name}: it is still enrolled\n`);
        return ENROLL_EXIT.ENROLLED;
      case HOST_ENROLL_OUTCOME.REFUSED:
        process.stderr.write(
          "Luke refused the install token: it is unknown, revoked, or past its 24 hours. Copy a fresh command from Settings › Agents › Hosts › Add hosts.\n",
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
    process.stderr.write("usage: luke-host run | enroll [--token <token>] | version | uninstall\n"),
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
