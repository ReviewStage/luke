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
  type MacShellCommand,
  type MacShellResult,
} from "@luke/features/mac-command-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, invalid } from "@luke/gateway";
import { MAC_COMMAND_MODE, type MacCommandMode } from "@luke/settings";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  Config,
  Deferred,
  Duration,
  Effect,
  FiberSet,
  Option,
  Result,
  Schedule,
  Schema,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Environment, Reporter } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { LiveBroken, type LiveClient, liveRows, openRealtimeClient } from "./live-follow.js";
import {
  MAC_COMMAND_DECISION,
  type MacCommandAsk,
  type MacCommandDecision,
  macCommandAnswerSchema,
} from "./mac-command-ask.js";
import { type MacShell, runMacCommand } from "./mac-command-runner.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-mac-commands.ts -- runs on this Mac the commands the account's agents queue for it, for as long as an account is signed in and Settings lets agents run commands here, asking the developer first where Settings says to.
 *
 * Settings › This Mac decides (`@luke/settings`'s `MAC_COMMAND_MODE`): Ask
 * every time, the default, shows the developer each shell command before
 * it runs; Always allow runs any command of the account's agents without
 * asking; Never is the brake, under which nothing is read. While the gate
 * stands, the commands no Mac has
 * claimed, of the kinds this Mac runs, are followed through the live layer
 * (`live-follow.ts`: over Neon Realtime where the deployment turns it on,
 * otherwise a poll the service holds until the rows move), and each one
 * heard of is claimed by its id; the service grants a claim once, so when
 * two Macs of one account follow, only the one it granted runs it. Each
 * claimed command runs on a fiber of its own in the concern's scope, by its
 * kind: a shell command in the login shell from the home folder
 * (`mac-command-runner.ts`), and a command of a kind this Mac cannot run
 * answered with a refusal. Its result is posted back, so a long command
 * holds up neither the follow nor the others.
 *
 * Under Ask every time, a claimed shell command is held as an ask
 * (`mac-command-ask.ts`) on the same fiber, so one waiting holds up neither
 * the follow nor another ask: the asks waiting are told as
 * `MAC_COMMAND_ASKS_CHANGED` each time one is asked or answered, the panel
 * draws them, and its answer comes back as `MAC_COMMAND_ANSWER` by the
 * ask's id. Allow once runs the command; Always allow writes the setting to
 * Always allow and runs it; Deny, or no answer before the command's own
 * timeout has passed since it was asked, answers the call as not run, in
 * words the agent can act on, through the same refusal a command of a kind
 * this Mac cannot run is answered with.
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
/**
 * How a claim the service did not answer is asked again: a second apart, a
 * few times, well inside the service's thirty-second claim window, since
 * the rows that named it may not change again to say so.
 */
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;

/** The login shell when the environment names none: macOS's own default. */
const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

/** The kinds of command this Mac runs, which every read names: shell alone, for now. */
const RUNS: readonly MacCommandKind[] = [MAC_COMMAND_KIND.SHELL];

/** The service's side of the commands, as this concern asks it. */
export type MacCommandClient = Pick<
  HostedMacCommandClient,
  "live" | "claim" | "listening" | "settle"
>;

export interface MacCommandsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** How Settings lets agents run commands on this Mac, read as each follow begins, on every beat, and as each claimed command is about to run. */
  mode: Effect.Effect<MacCommandMode>;
  /** Writes the setting to Always allow, answering whether the write landed: the prompt's Always allow, which also runs the command asked. */
  allowAlways: Effect.Effect<boolean>;
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

/** What a command the developer declined answers. */
const DECLINED: MacCommandRefusal = {
  refused: "Not run: the developer declined this command.",
};

/** What a command the developer did not answer for answers: not run, since its timeout had passed before it could start. */
const UNANSWERED: MacCommandRefusal = {
  refused:
    "Not run: the developer did not answer in time whether to allow this command on their Mac.",
};

/** What a command asked under an account that signed out before it was answered answers. */
const ACCOUNT_CHANGED: MacCommandRefusal = {
  refused: "Not run: the account signed in on the developer's Mac changed before it was allowed.",
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
    const { kernel, account, mode, allowAlways, client } = dependencies;
    const openLive = dependencies.openLive ?? openRealtimeClient;
    const decode = Schema.decodeUnknownOption(macCommandsLiveRowsSchema);
    const readAnswer = readEither(macCommandAnswerSchema);
    /** The asks waiting on the developer, by the command's id, the earliest asked first, each with the account it was claimed for. */
    const asks = new Map<
      string,
      { ask: MacCommandAsk; userId: string; decided: Deferred.Deferred<MacCommandDecision> }
    >();

    const tellAsks = () =>
      kernel.emit(
        GATEWAY_EVENT.MAC_COMMAND_ASKS_CHANGED,
        carried({ asks: [...asks.values()].map((held) => held.ask) }),
      );

    /**
     * The developer's answer to one claimed shell command, asked of the
     * panel and waited for until `deadline`, the command's own timeout
     * past the claim; no answer by then is a denial of its own kind. The
     * ask is withdrawn however the wait ends, an interruption included, so
     * a prompt never outlives its command.
     */
    const consent = (
      command: MacShellCommand,
      userId: string,
      deadline: number,
    ): Effect.Effect<MacCommandDecision | undefined> =>
      Effect.gen(function* () {
        const decided = yield* Deferred.make<MacCommandDecision>();
        asks.set(command.id, {
          ask: { id: command.id, command: command.command, askedAt: kernel.now() },
          userId,
          decided,
        });
        tellAsks();
        const now = yield* Clock.currentTimeMillis;
        return yield* Deferred.await(decided).pipe(
          Effect.timeoutOption(Duration.millis(Math.max(0, deadline - now))),
          Effect.map(Option.getOrUndefined),
          Effect.ensuring(
            Effect.sync(() => {
              asks.delete(command.id);
              tellAsks();
            }),
          ),
        );
      });

    /** The asks of any account but the one signed in, let go: their prompts come down, and their calls hear nothing from this Mac. */
    const withdrawOtherAccounts = Effect.gen(function* () {
      const signedIn = dependencies.accountId();
      for (const held of asks.values()) {
        if (held.userId !== signedIn) yield* Deferred.interrupt(held.decided);
      }
    });

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

    /** One result posted back; one the service did not take is let go, its call already given up. */
    const settled = (id: string, result: MacCommandResult) =>
      Effect.asVoid(asked(client.settle(id, result)));

    /** One command run and its result posted back. */
    const run = (command: MacCommandRead) =>
      Effect.flatMap(ran(command), (result) => settled(command.id, result));

    /**
     * One claimed command as the setting now says: run, or under Ask every
     * time, a shell command run only once the developer allows it, and
     * answered as declined or unanswered otherwise. The command's own
     * timeout is one deadline from the claim, over the wait for the answer
     * and the run together, so a command allowed late runs in what is left
     * of it, because the service waits for the result only that long past
     * queueing and a result after that is lost. Note that the wait for the
     * answer is interruptible inside the claim's uninterruptible region,
     * because a gate shut meanwhile, or the quit, must not hold on a prompt
     * nobody will answer; the service answers the call on its own clock
     * then. An Always allow the setting could not keep still runs the
     * command, which the developer allowed, and is reported, since the next
     * command asks again.
     */
    const decided = (command: MacCommandRead, userId: string) =>
      Effect.gen(function* () {
        if ((yield* mode) !== MAC_COMMAND_MODE.ASK || !isMacShellCommand(command)) {
          return yield* run(command);
        }
        const deadline =
          (yield* Clock.currentTimeMillis) +
          Duration.toMillis(Duration.seconds(command.timeoutSeconds));
        const decision = yield* Effect.interruptible(consent(command, userId, deadline));
        if (decision === undefined) return yield* settled(command.id, UNANSWERED);
        if (decision === MAC_COMMAND_DECISION.DENY) return yield* settled(command.id, DECLINED);
        if (dependencies.accountId() !== userId) return yield* settled(command.id, ACCOUNT_CHANGED);
        if (decision === MAC_COMMAND_DECISION.ALLOW_ALWAYS && !(yield* allowAlways)) {
          report("the Always allow setting could not be saved; the next command asks again");
        }
        const left = Math.ceil((deadline - (yield* Clock.currentTimeMillis)) / 1000);
        if (left < 1) return yield* settled(command.id, UNANSWERED);
        yield* run({ ...command, timeoutSeconds: Math.min(command.timeoutSeconds, left) });
      });

    /** Whether the Mac takes commands now: an account signed in, a run that sends, and the setting not Never. */
    const gateOpen = Effect.map(
      mode,
      (how) =>
        how !== MAC_COMMAND_MODE.NEVER &&
        kernel.runMode.sendsNetwork &&
        account.capabilitiesActive(),
    );

    /**
     * One command heard of, claimed by its id and, once granted, run on a
     * fiber of its own; with the gate shut since, answered as not run
     * instead. A claim the service did not answer is asked again a few times
     * (`CLAIM_RETRY`), since the rows that named it may not change again to
     * say so. Note that the claim and its answer are uninterruptible and run
     * on the concern's own set rather than the follow's fiber, because a
     * command the service granted is this Mac's alone to answer, and a follow
     * ended mid-claim would otherwise leave its call waiting out its time.
     */
    const claimed = (running: FiberSet.FiberSet, userId: string, command: MacCommandRead) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.claim(command.id)).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(CLAIM_RETRY.every),
            times: CLAIM_RETRY.times,
            until: (granted) => granted !== undefined,
          }),
        );
        // A claim refused, or never answered, runs nothing: the command is another Mac's, or its call has given up.
        if (answer === undefined || !("id" in answer)) return;
        if (!(yield* gateOpen)) {
          yield* asked(client.settle(answer.id, SWITCHED_OFF));
          return;
        }
        yield* FiberSet.run(running, decided(answer, userId));
      }).pipe(Effect.uninterruptible);

    /**
     * That this Mac listens for its kinds, said every `LISTENING_EVERY` for
     * as long as the gate stands and the account signed in is the one the
     * follow is for; it returns once either changes, which ends the follow.
     */
    const presence = (userId: string) =>
      Effect.gen(function* () {
        while ((yield* gateOpen) && dependencies.accountId() === userId) {
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
     * queued first (`claimed`). A command is claimed once per follow, and
     * forgotten once it leaves the rows, so the ids this keeps are only those
     * still waiting. A follow ends where the gate shuts, the session signs
     * out, or the account signed in changes.
     */
    const followed = (running: FiberSet.FiberSet, userId: string, first: MacCommandsLiveAnswer) =>
      Effect.suspend(() => {
        let tried = new Set<string>();
        const claimNew = (commands: readonly MacCommandRead[]) =>
          Effect.gen(function* () {
            const fresh = commands.filter((command) => !tried.has(command.id));
            tried = new Set(commands.map((command) => command.id));
            for (const command of fresh) {
              yield* FiberSet.run(running, claimed(running, userId, command));
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
        return Effect.raceFirst(following, presence(userId)).pipe(
          Effect.catch(() => Effect.sleep(LIVE_RESTART)),
        );
      });

    /**
     * One turn of the loop: the commands followed until the gate shuts, the
     * read asked again after a pause where the service did not answer it or
     * signed the session out; with the gate shut, every command still
     * running stopped (its process group killed as its scope closes) and a
     * rest. Every turn begins by letting go of the asks of any account but
     * the one signed in, since a follow ends as the account changes.
     */
    const turn = (running: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        yield* withdrawOtherAccounts;
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

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MAC_COMMANDS> = {
      /** The developer's answer to one ask, by its id; one no longer waiting, answered or timed out, is told so. */
      [GATEWAY_METHOD.MAC_COMMAND_ANSWER]: (params) =>
        Effect.gen(function* () {
          const read = readAnswer(unparsedWire(params));
          if (Result.isFailure(read))
            return yield* invalid("an answer names an ask and a decision");
          const held = asks.get(read.success.id);
          if (held === undefined) return carried({ answered: false });
          yield* Deferred.succeed(held.decided, read.success.decision);
          return carried({ answered: true });
        }),
    };
    return { methods, lifetime } satisfies MacCommandsComposer;
  });
}
