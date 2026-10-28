import { existsSync } from "node:fs";
import path from "node:path";
import {
  HOST_LOGIN_ITEM_ACT,
  HOST_LOGIN_ITEM_STATUS,
  type HostLoginItemAct,
  type HostLoginItemStatus,
  ThisMacHost,
  type ThisMacHostSeam,
} from "@luke/host/effect";
import { Duration, Effect, Fiber, Layer, Option, Ref, Result, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { app } from "electron";

/**
 * host-login-item.ts -- This Mac's `luke-host` as the host asks it (`@luke/host/effect`'s `ThisMacHost`): its login item registered, unregistered, or where it stands, and the version of the `luke-host` the app carries.
 *
 * A packaged app carries the login item, a launchd job in its
 * `Contents/Library/LaunchAgents` that runs Luke's host daemon as the member
 * at login, whether or not the app is open, on the app's own state folder
 * (`@luke/host/daemon`'s `DARWIN_HOST`), and acts on it through its own
 * `luke-host` command (`native/macos/HostLoginItem.swift`), which reaches
 * `SMAppService`. A development run carries no login item, so it runs the
 * same daemon as a child of the app instead, from the release folder the
 * host's build stages (`pnpm --filter @luke/desktop build:host`), on the
 * development app's own state folder: registering starts it, unregistering
 * stops it, and it stops with the app.
 */

const COMMAND = "luke-host";

/** How long the command may take; `SMAppService` answers at once. */
const ACT_WITHIN = Duration.seconds(30);

/** The variables a development run's daemon reads its state folder and runner's folder from, since it ships in no app to name them. */
const DEVELOPMENT_VARIABLE = {
  STATE_ROOT: "LUKE_HOST_STATE_ROOT",
  RUNNER_FOLDER: "LUKE_HOST_RUNNER_FOLDER",
} as const;

/** The command given run once: what it printed, or the words it failed with. */
const printedBy = (command: string, args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args], { stdin: "ignore" });
      const [printed, said] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" },
      );
      const code = Number(yield* handle.exitCode);
      return code === 0
        ? Result.succeed<string>(printed.trim())
        : Result.fail(said.trim() || `${COMMAND} ${args.join(" ")} exited ${code}`);
    }),
  ).pipe(
    Effect.timeoutOption(ACT_WITHIN),
    Effect.map(
      Option.getOrElse(() =>
        Result.fail<string>(`${COMMAND} did not answer in ${Duration.format(ACT_WITHIN)}`),
      ),
    ),
    Effect.catch((failure) => Effect.succeed(Result.fail(`${COMMAND}: ${String(failure)}`))),
  );

/** The packaged app's `luke-host`, beside its own executable in `Contents/MacOS`, through `SMAppService`. */
const packagedHost: ThisMacHostSeam = (() => {
  const command = path.join(path.dirname(process.execPath), COMMAND);
  return {
    loginItem: (act: HostLoginItemAct) =>
      Effect.map(printedBy(command, [act]), (printed) =>
        Result.flatMap(printed, (word) => {
          const status = Object.values(HOST_LOGIN_ITEM_STATUS).find((each) => each === word);
          return status === undefined
            ? Result.fail(`${COMMAND} ${act} printed no status`)
            : Result.succeed<HostLoginItemStatus>(status);
        }),
      ),
    version: printedBy(command, ["version"]),
  };
})();

/** A development run's daemon, run as a child of the app on its state folder, from the release the host's build staged. */
const developmentHost = (stateRoot: string) =>
  Effect.gen(function* () {
    const release = path.join(app.getAppPath(), ".build", COMMAND);
    const node = path.join(release, "node", "bin", "node");
    const bundle = path.join(release, "lib", "luke-host.mjs");
    const staged = () => existsSync(node) && existsSync(bundle);
    const unstaged = `this development build has no staged ${COMMAND}: run pnpm --filter @luke/desktop build:runner and build:host`;
    const scope = yield* Effect.scope;
    const running = yield* Ref.make(Option.none<Fiber.Fiber<unknown, unknown>>());
    /** Whether the child runs now, set as it starts and cleared as it ends, whatever ended it. */
    const alive = yield* Ref.make(false);
    const daemon = Effect.scoped(
      Effect.flatMap(
        ChildProcess.make(node, [bundle, "run"], {
          // Note that the runner is the one the development build's own VMs mount, as a packaged app's is its own.
          env: {
            [DEVELOPMENT_VARIABLE.STATE_ROOT]: stateRoot,
            [DEVELOPMENT_VARIABLE.RUNNER_FOLDER]: path.resolve(
              app.getAppPath(),
              "..",
              "..",
              "packages",
              "agent-runner",
              "dist",
            ),
          },
          extendEnv: true,
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
        }),
        (handle) => handle.exitCode,
      ),
    ).pipe(Effect.ensuring(Ref.set(alive, false)));
    const status = Effect.map(Ref.get(alive), (up) =>
      up ? HOST_LOGIN_ITEM_STATUS.ENABLED : HOST_LOGIN_ITEM_STATUS.NOT_REGISTERED,
    );
    const seam: ThisMacHostSeam = {
      loginItem: (act) =>
        Effect.gen(function* () {
          if (!staged()) return Result.fail(unstaged);
          if (act === HOST_LOGIN_ITEM_ACT.REGISTER && !(yield* Ref.get(alive))) {
            yield* Ref.set(alive, true);
            yield* Ref.set(running, Option.some(yield* Effect.forkIn(daemon, scope)));
          }
          if (act === HOST_LOGIN_ITEM_ACT.UNREGISTER) {
            const fiber = yield* Ref.getAndSet(running, Option.none());
            if (Option.isSome(fiber)) yield* Fiber.interrupt(fiber.value);
          }
          return Result.succeed<HostLoginItemStatus>(yield* status);
        }),
      version: Effect.suspend(() =>
        staged() ? printedBy(node, [bundle, "version"]) : Effect.succeed(Result.fail(unstaged)),
      ),
    };
    return seam;
  });

/** This Mac's `luke-host` for the host: the login item where the app is packaged, a child of the app where it is a development run. */
export function thisMacHostLayer(options: {
  readonly packaged: boolean;
  readonly stateRoot: string;
}) {
  return options.packaged
    ? Layer.succeed(ThisMacHost, packagedHost)
    : Layer.effect(ThisMacHost, developmentHost(options.stateRoot));
}
