/**
 * main.ts -- the host daemon's process: `luke-host run` follows the box's local agents for as long as its service runs, `luke-host enroll` trades an install token for the box's device secret, and `luke-host version` prints the daemon's version.
 *
 * Bundled into one file (`pnpm --filter @luke/host-daemon build`) that the
 * host's release carries at `lib/luke-host.mjs`, beside the runner's bundle
 * at `lib/agent-runner.mjs` (`linux-platform.ts`), and runs on the release's
 * own Node, which every runner runs on too. Every command runs as the
 * `luke-host` user, whose home holds the daemon's state, `state/` under it.
 *
 * `run` is the command the box's system service runs. A box
 * that never enrolled says so and reads its record again every
 * `UNENROLLED_REST`, rather than exiting for systemd to start it over; one
 * that did runs the daemon (`@luke/host/linux-host`) until the service is
 * stopped, which stops every runner it started with it, or until Luke
 * refuses the box's secret, the host removed, when it stops them and exits 0,
 * which the service's `Restart=on-failure` leaves stopped. Every agent runs
 * in a smolvm VM of its own (`linuxPlatform`), on the image's own `gh`, with
 * `/dev/kvm` passed through where the box has it, through the `smolvm` the
 * install script put at a fixed path and named in
 * the service's environment (`SMOLVM_ENV`), never the one `PATH` happens to
 * hold. Before it follows anything it asks that `smolvm` for its `--version`
 * (`hostSmolvmRefusal`) and, where it is not the pinned release, says so and
 * exits `RUN_EXIT.SMOLVM_REFUSED`, which the service's
 * `RestartPreventExitStatus` leaves stopped, since a restart would only
 * repeat the refusal.
 *
 * `enroll` is run once as the box is set up: it reads the install token on stdin,
 * where `--token` gives none, prints the one line the script shows, and
 * exits by how the enroll ended (`ENROLL_EXIT`), never printing the token or
 * the secret.
 */

import { existsSync, readFileSync } from "node:fs";
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
import { Environment, reporterLayer } from "@luke/host/effect";
import {
  enrollHostDevice,
  hostArch,
  hostDaemon,
  hostSmolvmRefusal,
  linuxPlatform,
  readHostDevice,
} from "@luke/host/linux-host";
import { reportToStderr } from "@luke/host/node";
import { ConfigProvider, Duration, Effect, Exit, Layer, Option } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

/** The daemon's version, which the release's build writes in; a development run is below every floor. */
const VERSION = process.env.LUKE_HOST_VERSION ?? "0.0.0";

/** The variable the install script's service names the `smolvm` every agent's VM runs under in, by its whole path. */
const SMOLVM_ENV = "LUKE_HOST_SMOLVM";

/** The device a box hands each agent's VM so it can boot VMs of its own, where the box has it. */
const KVM = "/dev/kvm";

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

/** The `luke-host` user's home, which systemd hands its service, and the daemon's state under it. */
const home = process.env.HOME ?? os.homedir();
const stateRoot = path.join(home, "state");

const nodeServices = Layer.mergeAll(
  NodeChildProcessSpawner.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  ),
  FetchHttpClient.layer,
  reporterLayer(reportToStderr),
  Layer.succeed(Environment, ConfigProvider.fromEnv()),
);

/** The box's architecture, or a failure naming it where no release is built for it. */
const arch = Effect.suspend(() => {
  const read = hostArch(process.arch);
  return read === undefined
    ? Effect.fail(`Luke host runs on x64 and arm64 Linux, not ${process.arch}.`)
    : Effect.succeed(read);
});

/** The line `run` refuses to start with where the box's `smolvm` is not the pinned release or its path was not named; none where it is fine. */
const smolvmRefusal = (smolvm: string) =>
  smolvm.length === 0
    ? Effect.succeed(
        Option.some(
          `Luke host: ${SMOLVM_ENV} names no smolvm, so it will not start. Run the install command again (Settings › Agents › Hosts) to set this box's service up.`,
        ),
      )
    : hostSmolvmRefusal(smolvm);

/** The daemon on the box's record, or a rest until there is one, its agents' VMs run by the `smolvm` given; it ends once Luke refuses the box's secret. */
const follow = (smolvm: string) =>
  Effect.gen(function* () {
    const device = yield* readHostDevice(stateRoot);
    if (Option.isNone(device)) {
      reportToStderr(
        "Luke host: this box is not enrolled. Run the install command from Settings › Agents › Hosts, with its --token.",
      );
      yield* Effect.sleep(UNENROLLED_REST);
      return false;
    }
    const boxArch = yield* arch;
    const platform = linuxPlatform({
      installFolder,
      arch: boxArch,
      hostname: os.hostname(),
      stateRoot,
      smolvm,
      // Note that every command in an agent's VM runs as luke-host, which owns the agent's folder it mounts.
      user: { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 },
      kvm: existsSync(KVM),
    });
    reportToStderr(
      `Luke host ${VERSION}: following ${device.value.serviceOrigin} as ${os.hostname()}.`,
    );
    yield* hostDaemon({ stateRoot, device: device.value, version: VERSION, platform });
    reportToStderr(
      "Luke host: every agent it ran is stopped. It exits until this box is enrolled again.",
    );
    return true;
  }).pipe(Effect.repeat({ until: (removed) => removed }));

/** `luke-host run`: the daemon, once the box's `smolvm` is the pinned release; the exit code it ends with otherwise. */
const run = Effect.gen(function* () {
  const smolvm = process.env[SMOLVM_ENV] ?? "";
  const refusal = yield* smolvmRefusal(smolvm);
  if (Option.isSome(refusal)) {
    reportToStderr(refusal.value);
    return RUN_EXIT.SMOLVM_REFUSED;
  }
  yield* follow(smolvm);
  return 0;
});

/** `luke-host enroll`: the install token traded for the box's secret, and the one line the install script shows. */
const enroll = (token: string, name: string, origin: string) =>
  Effect.gen(function* () {
    const outcome = yield* enrollHostDevice({
      stateRoot,
      serviceOrigin: origin.replace(/\/+$/u, ""),
      installToken: token,
      name,
      arch: yield* arch,
      version: VERSION,
    });
    switch (outcome.outcome) {
      case HOST_ENROLL_OUTCOME.ENROLLED:
        process.stdout.write(`Enrolled as ${name} (secret kept readable by luke-host only)\n`);
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
  if (command === COMMAND.RUN) return run;
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
    return enroll(token, values.name ?? os.hostname(), values.origin ?? DEFAULT_SERVICE_ORIGIN);
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
