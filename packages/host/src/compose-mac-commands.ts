import type { HostedMacCommandClient } from "@luke/features";
import {
  isMacBrowserCommand,
  isMacShellCommand,
  MAC_COMMAND_BOUNDS,
  MAC_COMMAND_KIND,
  type MacBrowserCommand,
  type MacBrowserParams,
  type MacCommandKind,
  type MacCommandRead,
  type MacCommandRefusal,
  type MacCommandResult,
  type MacShellResult,
  macBrowserParamsSchema,
} from "@luke/features/mac-command-wire";
import { Config, Duration, Effect, FiberSet, Option, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Environment, Reporter } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import { type MacCommandSettleClient, settleMacCommandResult } from "./mac-browser-result.js";
import { type MacShell, runMacCommand } from "./mac-command-runner.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-mac-commands.ts -- runs on this Mac the commands the account's agents queue for it, for as long as an account is signed in and Settings lets agents run commands here.
 *
 * Nothing asks the developer first: Dean's call, with the setting the one
 * brake, on by default. While the gate stands, one held read after another
 * takes every command waiting for the account of the kinds this Mac runs,
 * which each read names (`HostedMacCommandClient`); each runs on a fiber of
 * its own in the concern's scope, by its kind: a shell command in the
 * login shell from the home folder (`mac-command-runner.ts`), a browser
 * command on the task's Browser tabs through this Mac's node, which owns
 * the views (`mac-browser-tabs.ts`), and a command of a kind this Mac
 * cannot run answered with a refusal rather than spoiling the read. Browser
 * commands are read only while the Browser tab experiment is on too, so a
 * Mac with it off is never handed one. Its result is posted back by the route its kind
 * takes (`mac-browser-result.ts`), so a long command holds up neither the
 * next read nor the others.
 * A Mac holding the read is what the service counts as listening, so the
 * setting switched off, a sign-out, or a run that sends nothing stops the
 * reads and the agents' calls are told no Mac listens, and stops every
 * command still running, its process group killed. When two Macs of one
 * account hold the read, whichever read takes a command runs it, and only
 * that one: the service claims it once. Quitting closes the scope, which
 * kills every command still running with its process group.
 */

/** How long the reads rest while the gate is shut, or after one that went unanswered or died. */
const IDLE = Duration.seconds(5);

/** The login shell when the environment names none: macOS's own default. */
const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

/** The kinds of command this Mac runs, which every read names: shell always, and browser while the Browser tab experiment is on. */
const RUNS = {
  SHELL: [MAC_COMMAND_KIND.SHELL],
  BROWSER: [MAC_COMMAND_KIND.SHELL, MAC_COMMAND_KIND.BROWSER],
} as const satisfies Record<string, readonly MacCommandKind[]>;

/** The service's side of the commands, as this concern asks it. */
export type MacCommandClient = Pick<HostedMacCommandClient, "waiting"> & MacCommandSettleClient;

export interface MacCommandsDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** Whether Settings lets agents run commands on this Mac, read as each read begins. */
  enabled: Effect.Effect<boolean>;
  client: MacCommandClient;
  /** The Browser tabs' side: whether the account has the Browser tab experiment on, and one command's actions run on this Mac's tabs. */
  browser: {
    enabled: Effect.Effect<boolean>;
    run: (params: MacBrowserParams) => Effect.Effect<MacCommandResult>;
  };
}

export type MacCommandsComposer = Composer;

/** What a command taken as the setting was switched off, or the account signed out, answers. */
const SWITCHED_OFF: MacShellResult = {
  exitCode: null,
  stdout: "",
  stderr: "Not run: commands on this Mac were switched off as it arrived.",
  truncated: false,
  timedOut: false,
};

/** What a command of a kind this Mac cannot run answers, such as one a newer service queued. */
const CANNOT_RUN: MacCommandRefusal = {
  refused:
    "Not run: Luke on the developer's Mac cannot run this kind of command; updating Luke there " +
    "may let it.",
};

/** What a browser command answers once the Browser tab experiment went off. */
const BROWSER_OFF: MacCommandRefusal = {
  refused:
    "Not run: the Browser tab experiment is off in Luke on the developer's Mac " +
    "(Settings › Experimental › Browser tab).",
};

/** What a browser command answers where its params could not be read, and why. */
function unreadParams(error: Schema.SchemaError): MacCommandRefusal {
  const words = `Not run: the browser command's params could not be read: ${error.message}`;
  return { refused: words.slice(0, MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS) };
}

/** What a browser command answers when its actions outran its time. */
function outran(seconds: number): MacCommandRefusal {
  return {
    refused: `Not run in time: the browser actions did not finish within ${seconds} seconds.`,
  };
}

const decodeBrowserParams = Schema.decodeUnknownResult(macBrowserParamsSchema);

/** What a command answers where the environment names no home folder to run it from. */
const NO_HOME: MacShellResult = {
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
  Environment | Reporter | ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const shell = yield* macShell;
    const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();
    const http = yield* HttpClient.HttpClient;
    const { kernel, account, enabled, client, browser } = dependencies;

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideService(call, HttpClient.HttpClient, http);

    /**
     * A browser command's actions run on the task's tabs within its time,
     * once its params read and while the experiment is still on; refused in
     * words otherwise.
     */
    const ranBrowser = (command: MacBrowserCommand): Effect.Effect<MacCommandResult> =>
      Effect.gen(function* () {
        if (!(yield* browser.enabled)) return BROWSER_OFF;
        const params = decodeBrowserParams(command.params);
        if (Result.isFailure(params)) return unreadParams(params.failure);
        return yield* browser.run(params.success).pipe(
          Effect.timeoutOrElse({
            duration: Duration.seconds(command.timeoutSeconds),
            orElse: () => Effect.succeed(outran(command.timeoutSeconds)),
          }),
        );
      });

    /** What one command comes to, by its kind: a shell or browser command run, and any other kind refused. */
    const ran = (command: MacCommandRead): Effect.Effect<MacCommandResult> => {
      if (isMacBrowserCommand(command)) return ranBrowser(command);
      if (!isMacShellCommand(command)) return Effect.succeed(CANNOT_RUN);
      return Option.match(shell, {
        onNone: () => Effect.succeed(NO_HOME),
        onSome: (where) => runMacCommand(command, where),
      }).pipe(Effect.provideContext(services));
    };

    /** One command run and its result posted back; a result the service did not take is let go, its call already given up. */
    const run = (command: MacCommandRead) =>
      Effect.flatMap(ran(command), (result) =>
        Effect.asVoid(asked(settleMacCommandResult(client, command.id, result))),
      );

    /** Whether the Mac takes commands now: an account signed in, a run that sends, and the setting on. */
    const gateOpen = Effect.map(
      enabled,
      (on) => on && kernel.runMode.sendsNetwork && account.capabilitiesActive(),
    );

    /**
     * One turn of the loop: a held read and a fiber per command it took, or,
     * with the gate shut, every command still running stopped (its process
     * group killed as its scope closes) and a rest. Note that the gate is read
     * again once the read answers, because it may have shut while the read was
     * held, and a command taken then is answered as not run rather than run.
     */
    const turn = (running: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        if (!(yield* gateOpen)) {
          yield* FiberSet.clear(running);
          return yield* Effect.sleep(IDLE);
        }
        const kinds = (yield* browser.enabled) ? RUNS.BROWSER : RUNS.SHELL;
        const commands = yield* asked(client.waiting(kinds));
        // Note that an unanswered read rests before the next, so a service that is down is not asked in a tight loop.
        if (commands === undefined) return yield* Effect.sleep(IDLE);
        if (!(yield* gateOpen)) {
          yield* FiberSet.clear(running);
          for (const command of commands) yield* asked(client.settle(command.id, SWITCHED_OFF));
          return;
        }
        for (const command of commands) yield* FiberSet.run(running, run(command));
      });

    const lifetime = Effect.gen(function* () {
      const running = yield* FiberSet.make();
      // A turn that died is reported and the reads rest before the next, as a shut gate does.
      const guarded = Effect.catchDefect(turn(running), () =>
        Effect.andThen(
          Effect.sync(() => report("the Mac command read failed")),
          Effect.sleep(IDLE),
        ),
      );
      yield* Effect.forkScoped(Effect.forever(guarded));
    });

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MAC_COMMANDS> = {};
    return { methods, lifetime } satisfies MacCommandsComposer;
  });
}
