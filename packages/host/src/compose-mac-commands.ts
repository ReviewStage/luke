import type { HostedMacCommandClient } from "@luke/features";
import {
  type MacCommandsLiveAnswer,
  macCommandsLiveRowsSchema,
  macCommandsOfLiveRows,
} from "@luke/features/live-wire";
import type { MacCommand, MacCommandResult } from "@luke/features/mac-command-wire";
import { Config, Duration, Effect, FiberSet, Option, Schema, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Environment, Reporter } from "./effect/seams.js";
import type { HostKernel } from "./host-kernel.js";
import { LiveBroken, type LiveClient, liveRows, openRealtimeClient } from "./live-follow.js";
import { type MacShell, runMacCommand } from "./mac-command-runner.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-mac-commands.ts -- runs on this Mac the shell commands the account's agents queue for it, for as long as an account is signed in and Settings lets agents run commands here.
 *
 * Nothing asks the developer first: Dean's call, with the setting the one
 * brake, on by default. While the gate stands, the commands no Mac has
 * claimed are followed over Neon Realtime as Neon's guide says to
 * (`live-follow.ts`), and each one heard of is claimed by its id; the
 * service grants a claim once, so when two Macs of one account follow, only
 * the one it granted runs it. Each claimed command runs on a fiber of its
 * own in the concern's scope, in the login shell from the home folder
 * (`mac-command-runner.ts`), and its result is posted back, so a long
 * command holds up neither the subscription nor the others.
 *
 * A subscription writes nothing, so the Mac says it is listening itself,
 * every `LISTENING_EVERY`, well inside the service's freshness window: the
 * one timer that remains, because presence is a fact about this process
 * that no row change can carry. Each beat reads the gate first, so the
 * setting switched off, a sign-out, or a run that sends nothing ends the
 * follow and the beats, and the agents' calls are told no Mac listens; every
 * command still running is stopped, its process group killed.
 *
 * A service that seals nothing, an older one or one whose deployment has no
 * Realtime, is read as before: one held read after another, which claims
 * what waits and counts the Mac listening, asking again for the live read
 * every `LIVE_RETRY`. A subscription that stops for good is started again
 * after `LIVE_RESTART`. The sealed statement stays here, beside the bearer.
 * Quitting closes the scope, which kills every command still running with
 * its process group.
 */

/** How long the reads rest while the gate is shut, or after one that went unanswered or died. */
const IDLE = Duration.seconds(5);
/** How often a Mac following over Realtime says it listens: a third of the service's forty-five-second freshness window. */
const LISTENING_EVERY = Duration.seconds(15);
/** How long the held read stands in before the live read is asked for again. */
const LIVE_RETRY = Duration.minutes(5);
/** How long after a subscription stopped for good it is started again. */
const LIVE_RESTART = Duration.seconds(5);

/** The login shell when the environment names none: macOS's own default. */
const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

/** The service's side of the commands, as this concern asks it. */
export type MacCommandClient = Pick<
  HostedMacCommandClient,
  "waiting" | "settle" | "live" | "claim" | "listening"
>;

export interface MacCommandsDependencies {
  kernel: Pick<HostKernel, "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** Whether Settings lets agents run commands on this Mac, read as each read begins. */
  enabled: Effect.Effect<boolean>;
  client: MacCommandClient;
  /** Realtime's client at an address, which the commands are followed over; Realtime's own outside a test. */
  openLive?: (url: string) => LiveClient;
}

export type MacCommandsComposer = Composer;

/** What a command taken as the setting was switched off, or the account signed out, answers. */
const SWITCHED_OFF: MacCommandResult = {
  exitCode: null,
  stdout: "",
  stderr: "Not run: commands on this Mac were switched off as it arrived.",
  truncated: false,
  timedOut: false,
};

/** What a command answers where the environment names no home folder to run it from. */
const NO_HOME: MacCommandResult = {
  exitCode: null,
  stdout: "",
  stderr: "Luke could not start the command: this Mac names no home folder.",
  truncated: false,
  timedOut: false,
};

/** What a renewal answers where the service sealed nothing. */
const UNSEALED = { failure: "the service sealed nothing" } as const;

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
    const openLive = dependencies.openLive ?? openRealtimeClient;
    const decode = Schema.decodeUnknownOption(macCommandsLiveRowsSchema);

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
    const taken = (running: FiberSet.FiberSet, commands: readonly MacCommand[]) =>
      Effect.gen(function* () {
        if (!(yield* gateOpen)) {
          yield* FiberSet.clear(running);
          for (const command of commands) yield* asked(client.settle(command.id, SWITCHED_OFF));
          return;
        }
        for (const command of commands) yield* FiberSet.run(running, run(command));
      });

    /** One held read and what it took, as a Mac reads where the service seals nothing. */
    const heldTurn = (running: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        const commands = yield* asked(client.waiting());
        // Note that an unanswered read rests before the next, so a service that is down is not asked in a tight loop.
        if (commands === undefined) return yield* Effect.sleep(IDLE);
        yield* taken(running, commands);
      });

    /**
     * Held reads one after another until `LIVE_RETRY` has passed or the gate
     * shuts. Note that a read is never cut off by the deadline, because the
     * service claims what it answers, and a command claimed by a read no one
     * hears out would never run.
     */
    const held = (running: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        const until = kernel.now() + Duration.toMillis(LIVE_RETRY);
        while (kernel.now() < until && (yield* gateOpen)) yield* heldTurn(running);
      });

    /** That this Mac listens, said every `LISTENING_EVERY` for as long as the gate stands; it returns once the gate shuts. */
    const presence = Effect.gen(function* () {
      while (yield* gateOpen) {
        yield* asked(client.listening());
        yield* Effect.sleep(LISTENING_EVERY);
      }
    });

    /**
     * The unclaimed commands followed until the gate shuts, each new one
     * claimed by its id, the earliest queued first. A command is claimed
     * once per follow, whatever the service answered, and forgotten once it
     * leaves the rows, so the ids this keeps are only those still waiting.
     */
    const followed = (running: FiberSet.FiberSet, first: MacCommandsLiveAnswer) =>
      Effect.suspend(() => {
        let tried = new Set<string>();
        const claimNew = (commands: readonly MacCommand[]) =>
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
            reseal: () => Effect.map(asked(client.live()), (sealed) => sealed ?? UNSEALED),
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
     * One turn of the loop: the commands followed live, or held reads where
     * the service seals nothing, until the gate shuts; with the gate shut,
     * every command still running stopped (its process group killed as its
     * scope closes) and a rest.
     */
    const turn = (running: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        if (!(yield* gateOpen)) {
          yield* FiberSet.clear(running);
          return yield* Effect.sleep(IDLE);
        }
        const sealed = yield* asked(client.live());
        if (sealed === undefined) return yield* held(running);
        yield* followed(running, sealed);
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

    return { methods: {}, lifetime } satisfies MacCommandsComposer;
  });
}
