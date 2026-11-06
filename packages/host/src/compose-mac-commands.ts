import type { HostedMacCommandClient } from "@repo/features";
import {
  type MacCommandsLiveAnswer,
  macCommandsLiveRowsSchema,
  macCommandsOfLiveRows,
} from "@repo/features/live-wire";
import {
  isMacShellCommand,
  MAC_COMMAND_KIND,
  type MacCommandKind,
  type MacCommandRead,
  type MacCommandRefusal,
  type MacCommandResult,
  type MacShellCommand,
  type MacShellResult,
} from "@repo/features/mac-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, readParams } from "@repo/gateway";
import { MAC_COMMAND_MODE, type MacCommandMode } from "@repo/settings";
import {
  Clock,
  Config,
  Deferred,
  Duration,
  Effect,
  FiberSet,
  Option,
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
import { decodedLiveRows, LIVE_RESTART, waitOrRegained } from "./live-follow.js";
import {
  MAC_COMMAND_DECISION,
  type MacCommandAsk,
  type MacCommandDecision,
  macCommandAnswerSchema,
} from "./mac-command-ask.js";
import { type MacShell, runMacCommand } from "./mac-command-runner.js";
import type { RunMode } from "./run-mode.js";

const IDLE = Duration.seconds(5);
const LISTENING_EVERY = Duration.seconds(15);
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;
const CLAIM_WINDOW = Duration.seconds(30);
const MISSED_AFTER = Duration.seconds(5);

const DEFAULT_SHELL = "/bin/zsh";

const VARIABLE = { HOME: "HOME", SHELL: "SHELL" } as const;

const RUNS: readonly MacCommandKind[] = [MAC_COMMAND_KIND.SHELL];

const decodeLiveRows = Schema.decodeUnknownOption(macCommandsLiveRowsSchema);

export type MacCommandClient = Pick<
  HostedMacCommandClient,
  "live" | "claim" | "listening" | "settle"
>;

export interface MacCommandsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  accountId: () => string | undefined;
  mode: Effect.Effect<MacCommandMode>;
  allowAlways: Effect.Effect<boolean>;
  client: MacCommandClient;
}

export type MacCommandsComposer = Composer;

const SWITCHED_OFF: MacShellResult = {
  exitCode: null,
  stdout: "",
  stderr: "Not run: commands on this Mac were switched off as it arrived.",
  truncated: false,
  timedOut: false,
};

const DECLINED: MacCommandRefusal = {
  refused: "Not run: the developer declined this command.",
};

const UNANSWERED: MacCommandRefusal = {
  refused:
    "Not run: the developer did not answer in time whether to allow this command on their Mac.",
};

const ACCOUNT_CHANGED: MacCommandRefusal = {
  refused: "Not run: the account signed in on the developer's Mac changed before it was allowed.",
};

const CANNOT_RUN: MacCommandRefusal = {
  refused:
    `Not run: ${PRODUCT_NAME} on the developer's Mac cannot run this kind of command; updating ${PRODUCT_NAME} there ` +
    "may let it.",
};

const NO_HOME: MacShellResult = {
  exitCode: null,
  stdout: "",
  stderr: "Could not start the command: this Mac names no home folder.",
  truncated: false,
  timedOut: false,
};

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
    const asks = new Map<
      string,
      { ask: MacCommandAsk; userId: string; decided: Deferred.Deferred<MacCommandDecision> }
    >();

    const tellAsks = () =>
      kernel.emit(
        GATEWAY_EVENT.MAC_COMMAND_ASKS_CHANGED,
        carried({ asks: [...asks.values()].map((held) => held.ask) }),
      );

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

    const withdrawOtherAccounts = Effect.gen(function* () {
      const signedIn = dependencies.accountId();
      for (const held of asks.values()) {
        if (held.userId !== signedIn) yield* Deferred.interrupt(held.decided);
      }
    });

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideService(call, HttpClient.HttpClient, http);

    const ran = (command: MacCommandRead): Effect.Effect<MacCommandResult> => {
      if (!isMacShellCommand(command)) return Effect.succeed(CANNOT_RUN);
      return Option.match(shell, {
        onNone: () => Effect.succeed(NO_HOME),
        onSome: (where) => runMacCommand(command, where),
      }).pipe(Effect.provideContext(services));
    };

    const settled = (id: string, result: MacCommandResult) =>
      Effect.asVoid(asked(client.settle(id, result)));

    const run = (command: MacCommandRead) =>
      Effect.flatMap(ran(command), (result) => settled(command.id, result));

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

    const gateOpen = Effect.map(
      mode,
      (how) =>
        how !== MAC_COMMAND_MODE.NEVER &&
        kernel.runMode.sendsNetwork &&
        account.capabilitiesActive(),
    );

    const claimed = (running: FiberSet.FiberSet, userId: string, command: MacCommandRead) =>
      Effect.gen(function* () {
        const answer = yield* asked(client.claim(command.id)).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(CLAIM_RETRY.every),
            times: CLAIM_RETRY.times,
            until: (granted) => granted !== undefined,
          }),
        );
        if (answer === undefined || !("id" in answer)) return;
        if (!(yield* gateOpen)) {
          yield* asked(client.settle(answer.id, SWITCHED_OFF));
          return;
        }
        yield* FiberSet.run(running, decided(answer, userId));
      }).pipe(Effect.uninterruptible);

    const seal = (userId: string, poll: boolean, after?: string) =>
      asked(client.live(RUNS, userId, poll, after));

    const missed = (userId: string) =>
      Effect.map(seal(userId, true), (read): readonly MacCommandRead[] => {
        if ("failure" in read) return [];
        const { rows: carried, expiresAt: now } = read.queries.commands;
        const rows = decodeLiveRows({ commands: carried ?? [] });
        if (Option.isNone(rows)) return [];
        const late = rows.value.commands.filter((row) => {
          const waited = now - row.queuedAt;
          return (
            waited >= Duration.toMillis(MISSED_AFTER) && waited < Duration.toMillis(CLAIM_WINDOW)
          );
        });
        return macCommandsOfLiveRows({ commands: late });
      });

    const presence = (running: FiberSet.FiberSet, userId: string) =>
      Effect.gen(function* () {
        while ((yield* gateOpen) && dependencies.accountId() === userId) {
          yield* asked(client.listening(RUNS));
          const late = yield* missed(userId);
          if (late.length > 0) {
            report("the Mac command follow missed a command; it is claimed and followed again");
            yield* Effect.forEach(late, (command) => claimed(running, userId, command), {
              concurrency: "unbounded",
              discard: true,
            });
          }
          yield* Effect.sleep(LISTENING_EVERY);
          if (late.length > 0) return;
        }
      });

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
        const rows = decodedLiveRows(
          { poll: (after) => seal(userId, true, after) },
          first,
          macCommandsLiveRowsSchema,
        );
        const following = Stream.runForEach(rows, (read) => claimNew(macCommandsOfLiveRows(read)));
        return Effect.raceFirst(following, presence(running, userId)).pipe(
          Effect.catch(() => waitOrRegained(LIVE_RESTART)),
        );
      });

    const turn = (running: FiberSet.FiberSet) =>
      Effect.gen(function* () {
        yield* withdrawOtherAccounts;
        if (!(yield* gateOpen)) {
          yield* FiberSet.clear(running);
          return yield* Effect.sleep(IDLE);
        }
        const userId = dependencies.accountId();
        if (userId === undefined) return yield* Effect.sleep(IDLE);
        const sealed = yield* seal(userId, false);
        if ("failure" in sealed) return yield* waitOrRegained(LIVE_RESTART);
        yield* followed(running, userId, sealed);
      });

    const lifetime = Effect.gen(function* () {
      const running = yield* FiberSet.make();
      const guarded = Effect.catchDefect(turn(running), () =>
        Effect.andThen(
          Effect.sync(() => report("the Mac command read failed")),
          Effect.sleep(IDLE),
        ),
      );
      yield* Effect.forkScoped(Effect.forever(guarded));
    });

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MAC_COMMANDS> = {
      [GATEWAY_METHOD.MAC_COMMAND_ANSWER]: (params) =>
        Effect.gen(function* () {
          const read = yield* readParams(
            macCommandAnswerSchema,
            params,
            "an answer names an ask and a decision",
          );
          const held = asks.get(read.id);
          if (held === undefined) return carried({ answered: false });
          yield* Deferred.succeed(held.decided, read.decision);
          return carried({ answered: true });
        }),
    };
    return { methods, lifetime } satisfies MacCommandsComposer;
  });
}
