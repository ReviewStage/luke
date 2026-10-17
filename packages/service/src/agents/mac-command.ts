import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  claimMacCommands,
  macCommandResult,
  macCommandsWaiting,
  macListeningSince,
  markMacListening,
  queueMacCommand,
  withdrawMacCommand,
} from "@luke/database/models/mac-command-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import {
  MAC_COMMAND_BOUNDS,
  type MacCommand,
  type MacCommandResult,
  macCommandSchema,
} from "@luke/features/mac-command-wire";
import type { UnparsedWireValue } from "@luke/wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Clock, Duration, Effect, Option, Result, Schedule, Schema } from "effect";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { COMMAND_DESCRIPTION } from "./command-description.js";

/**
 * mac-command.ts -- a shell command an agent runs on the developer's own Mac: queued for the account, run by a signed-in Mac that holds the read for it, and its result handed back to the call.
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
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type MacCommandAnswer =
  | ({ readonly status: typeof MAC_COMMAND_STATUS.RAN } & MacCommandResult)
  | { readonly status: typeof MAC_COMMAND_STATUS.NOT_RUN; readonly reason: string };

/** What a call asks: the shell text, and how long it may run, the default where unsaid. */
interface MacCommandAsk {
  readonly command: string;
  readonly timeoutSeconds?: number;
}

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
 * Runs one command on the account's Mac and answers what it did: refused
 * at once where no Mac listens, and the row withdrawn however the wait
 * ends, an interrupted call's included.
 */
function runOnMac(
  userId: string,
  ask: MacCommandAsk,
): Effect.Effect<MacCommandAnswer, never, DatabaseServices> {
  const asked = readMacCommand({
    id: randomUUID(),
    command: ask.command,
    timeoutSeconds: ask.timeoutSeconds ?? MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS,
  });
  // A command the Mac's read would refuse is refused here, before it is queued where it would spoil that read.
  if (Result.isFailure(asked)) return Effect.succeed(notRun(MAC_COMMAND_REFUSAL.UNREADABLE));
  const queued = asked.success;
  const run = Effect.gen(function* () {
    if (!(yield* macListening(userId))) return notRun(MAC_COMMAND_REFUSAL.NO_MAC);
    const answered = yield* queueMacCommand(userId, queued).pipe(
      Effect.andThen(awaitedResult(userId, queued)),
      Effect.ensuring(Effect.ignore(withdrawMacCommand(userId, queued.id))),
    );
    if (Option.isNone(answered)) return notRun(MAC_COMMAND_REFUSAL.NO_ANSWER);
    return { status: MAC_COMMAND_STATUS.RAN, ...answered.value } satisfies MacCommandAnswer;
  });
  return Effect.catch(run, () => Effect.succeed(notRun(MAC_COMMAND_REFUSAL.UNAVAILABLE)));
}

/**
 * One `run_on_mac` call made for the account, whichever agent made it: its
 * input read against the tool's schema, then run as `runOnMac` runs it. The
 * one door every agent's tool goes through, so each root's tool is a line.
 */
export function runOnMacTool(
  userId: string,
  input: UnparsedWireValue,
): Effect.Effect<MacCommandAnswer, never, DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read)) return Effect.succeed(notRun(MAC_COMMAND_REFUSAL.UNREADABLE));
  const { command, timeout_seconds } = read.success;
  return runOnMac(
    userId,
    timeout_seconds === undefined ? { command } : { command, timeoutSeconds: timeout_seconds },
  );
}

/**
 * The Mac's held read: it is counted listening as the read arrives, and
 * answered with every waiting command claimed for it as soon as one waits,
 * or with none once the hold ends.
 */
export function macCommandsFor(userId: string): TaskStoreEffect<readonly MacCommand[]> {
  const queuedSince = Effect.map(
    Clock.currentTimeMillis,
    (now) => new Date(now - Duration.toMillis(MAC_COMMAND_SERVICE.CLAIM_WINDOW)),
  );
  return markMacListening(userId).pipe(
    Effect.andThen(
      Effect.flatMap(queuedSince, (since) => macCommandsWaiting(userId, since)).pipe(
        Effect.repeat({ schedule: Schedule.spaced(MAC_COMMAND_SERVICE.POLL), until: (any) => any }),
        Effect.timeoutOption(MAC_COMMAND_SERVICE.HOLD),
      ),
    ),
    Effect.andThen(Effect.flatMap(queuedSince, (since) => claimMacCommands(userId, since))),
  );
}
