import type { HostedMacCommandClient } from "@luke/features";
import {
  type MacCommandsLiveAnswer,
  macCommandsLiveRowsSchema,
  macCommandsOfLiveRows,
} from "@luke/features/live-wire";
import {
  isMacShellCommand,
  MAC_COMMAND_KIND,
  type MacCommandKind,
  type MacCommandRead,
  type MacCommandRefusal,
  type MacCommandResult,
  type MacShellResult,
} from "@luke/features/mac-command-wire";
import { Config, Duration, Effect, FiberSet, Option, Schema, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Environment, Reporter } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { LiveBroken, type LiveClient, liveRows, openRealtimeClient } from "./live-follow.js";
import { type MacCommandSettleClient, settleMacCommandResult } from "./mac-browser-result.js";
import { type MacShell, runMacCommand } from "./mac-command-runner.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-mac-commands.ts -- runs on this Mac the commands the account's agents queue for it, for as long as an account is signed in and Settings lets agents run commands here.
 *
 * Nothing asks the developer first: Dean's call, with the setting the one
 * brake, on by default. While the gate stands, the commands no Mac has
 * claimed, of the kinds this Mac runs, are followed through the live layer
 * (`live-follow.ts`: over Neon Realtime where the deployment turns it on,
 * otherwise a poll the service holds until the rows move), and each one
 * heard of is claimed by its id; the service grants a claim once, so when
 * two Macs of one account follow, only the one it granted runs it. Each
 * claimed command runs on a fiber of its own in the concern's scope, by its
 * kind: a shell command in the login shell from the home folder
 * (`mac-command-runner.ts`), and a command of a kind this Mac cannot run
 * answered with a refusal. Its result is posted back by the route its kind
 * takes (`mac-browser-result.ts`), so a long command holds up neither the
 * follow nor the others.
 *
 * A live read writes nothing, so the Mac says it listens for its kinds
 * itself, every `LISTENING_EVERY`, well inside the service's freshness
 * window: the one timer that remains, because presence is a fact about this
 * process that no row change can carry. Each beat reads the gate first, so
 * the setting switched off, a sign-out, or a run that sends nothing ends the
 * follow and the beats, the agents' calls are told no Mac listens, and every
 * command still running is stopped, its process group killed. Every read
 * names the account the follow started for, so one the service signs out
 * ends the follow. Quitting closes the scope, which kills every command
 * still running with its process group.
 */

/** How long the follow rests while the gate is shut, or after a turn that died. */
const IDLE = Duration.seconds(5);
/** How often a Mac following its commands says it listens: a third of the service's forty-five-second freshness window. */
const LISTENING_EVERY = Duration.seconds(15);
/** How long after a read went unanswered, or a follow stopped for good, it is asked again. */
const LIVE_RESTART = Duration.seconds(5);

/** The login shell when the environment names none: macOS's own default. */
const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

/** The kinds of command this Mac runs, which every read names: shell alone, for now. */
const RUNS: readonly MacCommandKind[] = [MAC_COMMAND_KIND.SHELL];

/** The service's side of the commands, as this concern asks it. */
export type MacCommandClient = Pick<HostedMacCommandClient, "live" | "claim" | "listening"> &
  MacCommandSettleClient;

export interface MacCommandsDependencies {
  kernel: Pick<HostKernel, "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** Whether Settings lets agents run commands on this Mac, read as each follow begins and on every beat. */
  enabled: Effect.Effect<boolean>;
  client: MacCommandClient;
  /** Realtime's client at an address, where the deployment follows over Realtime; Realtime's own outside a test. */
  openLive?: (url: string) => LiveClient | PromiseLike<LiveClient>;
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
    const { kernel, account, enabled, client } = dependencies;
    const openLive = dependencies.openLive ?? openRealtimeClient;
    const decode = Schema.decodeUnknownOption(macCommandsLiveRowsSchema);

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideService(call, HttpClient.HttpClient, http);

    /** What one command comes to, by its kind: a shell command run, and any other kind refused. */
    const ran = (command: MacCommandRead): Effect.Effect<MacCommandResult> => {
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
     * Commands taken from the service, each run on a fiber of its own; with
     * the gate shut since they were taken, answered as not run instead.
     * Note that the gate is read again once they are taken, because it may
     * have shut while they were on their way.
     */
    const taken = (running: FiberSet.FiberSet, commands: readonly MacCommandRead[]) =>
      Effect.gen(function* () {
        if (!(yield* gateOpen)) {
          yield* FiberSet.clear(running);
          for (const command of commands) yield* asked(client.settle(command.id, SWITCHED_OFF));
          return;
        }
        for (const command of commands) yield* FiberSet.run(running, run(command));
      });

    /** That this Mac listens for its kinds, said every `LISTENING_EVERY` for as long as the gate stands; it returns once the gate shuts. */
    const presence = Effect.gen(function* () {
      while (yield* gateOpen) {
        yield* asked(client.listening(RUNS));
        yield* Effect.sleep(LISTENING_EVERY);
      }
    });

    /** The unclaimed commands of this Mac's kinds, sealed or with `poll` inline, for the account `userId` names. */
    const seal = (userId: string, poll: boolean, after?: string) =>
      asked(client.live(RUNS, userId, poll, after));

    /**
     * The unclaimed commands followed (`live-follow.ts`, which polls the
     * service, held, where Realtime is off or fails) until the gate shuts or
     * the session signs out, each new one claimed by its id, the earliest
     * queued first. A command is claimed once per follow, whatever the
     * service answered, and forgotten once it leaves the rows, so the ids
     * this keeps are only those still waiting.
     */
    const followed = (running: FiberSet.FiberSet, userId: string, first: MacCommandsLiveAnswer) =>
      Effect.suspend(() => {
        let tried = new Set<string>();
        const claimNew = (commands: readonly MacCommandRead[]) =>
          Effect.gen(function* () {
            const fresh = commands.filter((command) => !tried.has(command.id));
            tried = new Set(commands.map((command) => command.id));
            for (const command of fresh) {
              const claimed = yield* asked(client.claim(command.id));
              if (claimed !== undefined) yield* taken(running, [claimed]);
            }
          });
        const rows = liveRows(
          {
            openLive,
            reseal: () => seal(userId, false),
            poll: (after) => seal(userId, true, after),
            now: kernel.now,
          },
          first,
        );
        const following = Stream.runForEach(rows, (delivered) =>
          Option.match(decode(delivered), {
            onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
            onSome: (read) => claimNew(macCommandsOfLiveRows(read)),
          }),
        );
        return Effect.raceFirst(following, presence).pipe(
          Effect.catch(() => Effect.sleep(LIVE_RESTART)),
        );
      });

    /**
     * One turn of the loop: the commands followed until the gate shuts, the
     * read asked again after a pause where the service did not answer it or
     * signed the session out; with the gate shut, every command still
     * running stopped (its process group killed as its scope closes) and a
     * rest.
     */
    const turn = (running: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        if (!(yield* gateOpen)) {
          yield* FiberSet.clear(running);
          return yield* Effect.sleep(IDLE);
        }
        // The account the follow starts for, which every read names, so one under another's session is refused as signed out.
        const userId = dependencies.accountId();
        if (userId === undefined) return yield* Effect.sleep(IDLE);
        const sealed = yield* seal(userId, false);
        if ("failure" in sealed) return yield* Effect.sleep(LIVE_RESTART);
        yield* followed(running, userId, sealed);
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
