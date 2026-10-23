import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  claimMacCommand,
  claimMacCommands,
  heardFromAnotherAccount,
  macCommandResult,
  macCommandsWaiting,
  macListeningSince,
  markMacListening,
  queueMacCommand,
  withdrawMacCommand,
} from "@luke/database/models/mac-command-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import {
  MAC_COMMAND_BOUNDS,
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
  type MacShellResult,
  macCommandSchema,
} from "@luke/features/mac-command-wire";
import type { UnparsedWireValue } from "@luke/wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Clock, Duration, Effect, Option, Result, Schedule, Schema } from "effect";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { COMMAND_DESCRIPTION } from "./command-description.js";

/**
 * mac-command.ts -- a command an agent runs on the developer's own Mac: queued for the account, run by a signed-in Mac that holds the read for it, and its result handed back to the call.
 *
 * Any agent may call it, the brain, a coding agent, and either's
 * workers, and nothing asks the developer first: Dean's call, with the one
 * brake a Settings switch on the Mac (`Let agents run commands on this
 * Mac`), which stops the Mac listening. The call refuses at once where no
 * Mac of the account listened lately, since nothing would take the command.
 * Otherwise it queues the command, looks for its result until the
 * command's own timeout and a grace for the Mac to answer have passed, and
 * withdraws the row whichever way it ends, so a row stands only while its
 * call does. A Mac may take a command only within the claim window of its
 * queueing, so one it takes always ends inside the call's wait, and a row
 * a call that died left behind is never run later. An ask the Mac's read
 * would refuse is refused before it is queued. The Mac's side is `GET /api/mac-commands`, held open while
 * nothing waits and answered with every waiting command claimed for it,
 * and `POST`, its result (`../mac-commands-app.ts`).
 *
 * A command is of a kind (`MAC_COMMAND_KIND`), and a Mac is handed only
 * the kinds its read named: shell, which every Mac runs, an older one's
 * read naming nothing, and each other kind a newer one names. So a call of
 * another kind is refused at once where no Mac that runs it listened
 * lately, rather than left for a Mac that would never take it, and a Mac
 * that took a command it would not run answers why, which the call
 * answers as not run.
 *
 * An agent's call runs on the Mac of the account its conversation is
 * under, its starter's, and only while no one else has put words into that
 * conversation: a teammate who messages the agent, or an agent of theirs
 * that does, could otherwise have it run their command on the starter's
 * Mac, so such a conversation is refused for the rest of its life.
 */

const MAC_COMMAND_SERVICE = {
  /** How long the Mac's read is held while nothing waits for it. */
  HOLD: Duration.seconds(20),
  /** How often a held read, and a call waiting on its result, looks again. */
  POLL: Duration.millis(500),
  /** How lately a Mac must have read for a call to count it listening: one hold, and room for the next read to arrive. */
  LISTENER_FRESH: Duration.seconds(45),
  /**
   * How long a command may wait for a Mac to take it; one not taken by then
   * is never run. A listening Mac takes one within a poll, and a command
   * taken inside this window ends inside the call's wait.
   */
  CLAIM_WINDOW: Duration.seconds(30),
  /** How long past the command's own timeout a call waits for the Mac to say what it did: the claim window, and room for the answer to travel. */
  ANSWER_GRACE: Duration.seconds(35),
} as const;

export const MAC_COMMAND_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

/** Why a call ran nothing, or never heard back, in words the model can act on. */
const MAC_COMMAND_REFUSAL = {
  NO_MAC:
    "Not run: Luke is not running on the developer's Mac, or they switched off " +
    "Settings › Let agents run commands on this Mac.",
  NO_ANSWER:
    "No answer: the developer's Mac did not say what the command did in time; it may or may " +
    "not have run.",
  UNAVAILABLE: "Not run: the command could not be queued. The call may be made again.",
  UNREADABLE:
    "Not run: `command` must be one non-empty shell command, and `timeout_seconds` a whole " +
    `number from 1 to ${MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS}.`,
  NOT_STARTERS_OWN:
    "Not run: someone other than the developer who started this agent has messaged it, so it " +
    "no longer runs commands on their Mac. Ask the developer to run what you need themselves.",
} as const;

/** Why a call ran nothing by its kind: no Mac that runs that kind listening, or an ask the Mac's read would refuse. */
const MAC_COMMAND_KIND_REFUSAL = {
  [MAC_COMMAND_KIND.SHELL]: {
    NO_MAC: MAC_COMMAND_REFUSAL.NO_MAC,
    UNREADABLE: MAC_COMMAND_REFUSAL.UNREADABLE,
  },
} as const satisfies Record<
  MacCommandKind,
  { readonly NO_MAC: string; readonly UNREADABLE: string }
>;

/** What a call answers: what a shell command did, or why nothing ran. */
// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type MacCommandAnswer =
  | ({ readonly status: typeof MAC_COMMAND_STATUS.RAN } & MacShellResult)
  | { readonly status: typeof MAC_COMMAND_STATUS.NOT_RUN; readonly reason: string };

/**
 * What a call asks of the Mac: a command of one kind, what that kind
 * carries, and how long it may run, the default where unsaid.
 */
export type MacCommandAsk = {
  readonly kind: typeof MAC_COMMAND_KIND.SHELL;
  readonly command: string;
  readonly timeoutSeconds?: number;
};

const readMacCommand = readEither(macCommandSchema);

const RUN_ON_MAC_INPUT = Schema.Struct({
  command: describeWire(
    Schema.String.check(Schema.isMinLength(1)),
    "One shell command, run in the developer's login shell from their home folder on their Mac, " +
      'such as "git -C ~/code/app status", "ls ~/code", or "node --version".',
  ),
  description: COMMAND_DESCRIPTION,
  timeout_seconds: Schema.optionalKey(
    describeWire(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS }),
      ),
      `Seconds before the command is killed; ${MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS} when ` +
        `left out, at most ${MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS}. Ask for longer only for a ` +
        "command that needs it, such as a test suite or a build.",
    ),
  ),
});

const readInput = readEither(RUN_ON_MAC_INPUT);

/**
 * The tool as every agent is offered it, the brain, a coding agent,
 * and either's workers alike: its name, its words, and its input schema.
 */
export const RUN_ON_MAC_TOOL = {
  name: AGENT_TOOL.RUN_ON_MAC,
  description:
    "Run one shell command on the developer's own Mac, in their login shell from their home " +
    "folder, and read what it printed. It runs at once, without asking the developer, and " +
    "reaches whatever the developer's account on the Mac reaches: their local checkouts and " +
    "uncommitted work, installed tools, running servers. Use it for what only the Mac has; " +
    "read the task's repository where you have it. Nothing reads stdin, so a command that asks " +
    `for input fails. It is killed after ${MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS} seconds ` +
    "unless `timeout_seconds` says otherwise. Answers the exit code, stdout, and stderr, each " +
    `cut to ${MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS} characters, or \`not-run\` and why, such as ` +
    "Luke not running on the Mac.",
  inputSchema: RUN_ON_MAC_INPUT,
} as const;

function notRun(reason: string): MacCommandAnswer {
  return { status: MAC_COMMAND_STATUS.NOT_RUN, reason };
}

/** Whether a Mac of the account read for its commands within the freshness window. */
function macListening(userId: string): TaskStoreEffect<boolean> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    macListeningSince(
      userId,
      new Date(now - Duration.toMillis(MAC_COMMAND_SERVICE.LISTENER_FRESH)),
    ),
  );
}

/** What a call answers for what the Mac said: what a shell command did, or why the Mac ran nothing. */
function answered(result: MacCommandResult): MacCommandAnswer {
  if ("refused" in result) return notRun(result.refused);
  return { status: MAC_COMMAND_STATUS.RAN, ...result };
}

/** The command's result once a Mac settles it, looked for until the deadline; nothing past it. */
function awaitedResult(
  userId: string,
  queued: MacCommand,
): TaskStoreEffect<Option.Option<MacCommandResult>> {
  const deadline = Duration.sum(
    Duration.seconds(queued.timeoutSeconds),
    MAC_COMMAND_SERVICE.ANSWER_GRACE,
  );
  return macCommandResult(userId, queued.id).pipe(
    Effect.repeat({
      schedule: Schedule.spaced(MAC_COMMAND_SERVICE.POLL),
      until: Option.isSome,
    }),
    Effect.timeoutOption(deadline),
    Effect.map(Option.flatten),
  );
}

/**
 * Runs one command on the account's Mac and answers what it came to:
 * refused at once where no Mac that runs its kind listens, and the row
 * withdrawn however the wait ends, an interrupted call's included.
 */
export function askMac(
  userId: string,
  ask: MacCommandAsk,
): Effect.Effect<MacCommandAnswer, never, DatabaseServices> {
  const refusal = MAC_COMMAND_KIND_REFUSAL[ask.kind];
  const asked = readMacCommand({
    ...ask,
    id: randomUUID(),
    timeoutSeconds: ask.timeoutSeconds ?? MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS,
  });
  // A command the Mac's read would refuse is refused here, before it is queued where it would spoil that read.
  if (Result.isFailure(asked)) return Effect.succeed(notRun(refusal.UNREADABLE));
  const queued = asked.success;
  const run = Effect.gen(function* () {
    if (!(yield* macListening(userId))) return notRun(refusal.NO_MAC);
    const result = yield* queueMacCommand(userId, queued).pipe(
      Effect.andThen(awaitedResult(userId, queued)),
      Effect.ensuring(Effect.ignore(withdrawMacCommand(userId, queued.id))),
    );
    if (Option.isNone(result)) return notRun(MAC_COMMAND_REFUSAL.NO_ANSWER);
    return answered(result.value);
  });
  return Effect.catch(run, () => Effect.succeed(notRun(MAC_COMMAND_REFUSAL.UNAVAILABLE)));
}

/**
 * One `run_on_mac` call made in the conversation, whichever agent made it:
 * its input read against the tool's schema, refused where another account
 * has put words into the conversation, then run on its owner's Mac as
 * `askMac` runs it. The one door every agent's tool goes through, so each
 * root's tool is a line.
 */
export function runOnMacTool(
  target: ConversationTarget,
  input: UnparsedWireValue,
): Effect.Effect<MacCommandAnswer, never, DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read)) return Effect.succeed(notRun(MAC_COMMAND_REFUSAL.UNREADABLE));
  const { command, timeout_seconds } = read.success;
  const kind = MAC_COMMAND_KIND.SHELL;
  const ask: MacCommandAsk =
    timeout_seconds === undefined
      ? { kind, command }
      : { kind, command, timeoutSeconds: timeout_seconds };
  return Effect.gen(function* () {
    const foreign = yield* Effect.result(heardFromAnotherAccount(target));
    // Note that a read that fails refuses, because a command run on a guess could be a stranger's.
    if (Result.isFailure(foreign)) return notRun(MAC_COMMAND_REFUSAL.UNAVAILABLE);
    if (foreign.success) return notRun(MAC_COMMAND_REFUSAL.NOT_STARTERS_OWN);
    return yield* askMac(target.userId, ask);
  });
}

/**
 * One command a Mac heard of live, claimed for it by its id where it still
 * waits inside the claim window; none where another Mac took it, its call
 * withdrew it, or it waited too long. The window is kept here, on the
 * service's clock, because the live statement can measure nothing from
 * one. Note that any kind is claimed, because the Mac hears only of the
 * kinds it named.
 */
export function claimedMacCommand(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<MacCommand>> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    claimMacCommand(
      userId,
      id,
      new Date(now - Duration.toMillis(MAC_COMMAND_SERVICE.CLAIM_WINDOW)),
      Object.values(MAC_COMMAND_KIND),
    ),
  );
}

/**
 * The Mac's held read, naming the kinds it runs: it is counted listening
 * for them as the read arrives, and answered with every waiting command of
 * those kinds claimed for it as soon as one waits, or with none once the
 * hold ends. A command of any other kind is left waiting for a Mac that
 * runs it, or for its call to give up on it.
 */
export function macCommandsFor(
  userId: string,
  kinds: readonly MacCommandKind[],
): TaskStoreEffect<readonly MacCommand[]> {
  const queuedSince = Effect.map(
    Clock.currentTimeMillis,
    (now) => new Date(now - Duration.toMillis(MAC_COMMAND_SERVICE.CLAIM_WINDOW)),
  );
  return markMacListening(userId).pipe(
    Effect.andThen(
      Effect.flatMap(queuedSince, (since) => macCommandsWaiting(userId, since, kinds)).pipe(
        Effect.repeat({ schedule: Schedule.spaced(MAC_COMMAND_SERVICE.POLL), until: (any) => any }),
        Effect.timeoutOption(MAC_COMMAND_SERVICE.HOLD),
      ),
    ),
    Effect.andThen(Effect.flatMap(queuedSince, (since) => claimMacCommands(userId, since, kinds))),
  );
}
