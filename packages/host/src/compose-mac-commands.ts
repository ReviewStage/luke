import type { HostedMacCommandClient } from "@sidecar/hosted";
import type { MacCommand, MacCommandResult } from "@sidecar/hosted/mac-command-wire";
import { Config, Duration, Effect, Option, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Environment, Reporter } from "./effect/seams.js";
import { type MacShell, runMacCommand } from "./mac-command-runner.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-mac-commands.ts -- runs on this Mac the shell commands the account's agents queue for it, for as long as an account is signed in and Settings lets agents run commands here.
 *
 * Nothing asks the developer first: Dean's call, with the setting the one
 * brake, on by default. While the gate stands, one held read after another
 * takes every command waiting for the account (`HostedMacCommandClient`);
 * each runs on a fiber of its own in the concern's scope, in the login shell
 * from the home folder (`mac-command-runner.ts`), and its result is posted
 * back, so a long command holds up neither the next read nor the others.
 * A Mac holding the read is what the service counts as listening, so the
 * setting switched off, a sign-out, or a run that sends nothing stops the
 * reads and the agents' calls are told no Mac listens. When two Macs of one
 * account hold the read, whichever read takes a command runs it, and only
 * that one: the service claims it once. Quitting closes the scope, which
 * kills every command still running with its process group.
 */

/** How long the reads rest while the gate is shut, or after one that went unanswered or died. */
const IDLE = Duration.seconds(5);

/** The login shell when the environment names none: macOS's own default. */
const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

/** The service's side of the commands, as this concern asks it. */
export type MacCommandClient = Pick<HostedMacCommandClient, "waiting" | "settle">;

export interface MacCommandsDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** Whether Settings lets agents run commands on this Mac, read as each read begins. */
  enabled: Effect.Effect<boolean>;
  client: MacCommandClient;
}

export type MacCommandsComposer = Composer;

/** What a command answers where the environment names no home folder to run it from. */
const NO_HOME: MacCommandResult = {
  exitCode: null,
  stdout: "",
  stderr: "Luke could not start the command: this Mac names no home folder.",
  truncated: false,
  timedOut: false,
};

/** Where commands run, from the environment the host was handed; nothing where it names no home. */
const macShell = Effect.gen(function* () {
  const environment = yield* Environment;
  const home = yield* Effect.orDie(Config.option(Config.String(VARIABLE.HOME)).parse(environment));
  const shell = yield* Effect.orDie(
    Config.withDefault(Config.String(VARIABLE.SHELL), DEFAULT_SHELL).parse(environment),
  );
  return Option.map(home, (folder): MacShell => ({ path: shell, home: folder }));
});

export function composeMacCommands(
  dependencies: MacCommandsDependencies,
): Effect.Effect<
  MacCommandsComposer,
  never,
  Environment | Reporter | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const shell = yield* macShell;
    const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
    const { kernel, account, enabled, client } = dependencies;

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provide(call, FetchHttpClient.layer);

    /** One command run and its result posted back; a result the service did not take is let go, its call already given up. */
    const run = (command: MacCommand) =>
      Effect.flatMap(
        Option.match(shell, {
          onNone: () => Effect.succeed(NO_HOME),
          onSome: (where) => runMacCommand(command, where),
        }),
        (result) => Effect.asVoid(asked(client.settle(command.id, result))),
      ).pipe(Effect.provideContext(services));

    /** One turn of the loop: a held read and a fiber per command it took, or a rest while the gate is shut. */
    const turn = (scope: Scope.Scope) =>
      Effect.gen(function* () {
        const open = kernel.runMode.sendsNetwork && account.capabilitiesActive();
        if (!open || !(yield* enabled)) return yield* Effect.sleep(IDLE);
        const commands = yield* asked(client.waiting());
        // Note that an unanswered read rests before the next, so a service that is down is not asked in a tight loop.
        if (commands === undefined) return yield* Effect.sleep(IDLE);
        for (const command of commands) yield* Effect.forkIn(run(command), scope);
      });

    const lifetime = Effect.gen(function* () {
      const scope = yield* Effect.scope;
      // A turn that died is reported and the reads rest before the next, as a shut gate does.
      const guarded = Effect.catchDefect(turn(scope), (defect) =>
        Effect.andThen(
          Effect.sync(() =>
            report(
              `the Mac command read failed: ${defect instanceof Error ? defect.message : String(defect)}`,
            ),
          ),
          Effect.sleep(IDLE),
        ),
      );
      yield* Effect.forkScoped(Effect.forever(guarded));
    });

    return { methods: {}, lifetime } satisfies MacCommandsComposer;
  });
}
