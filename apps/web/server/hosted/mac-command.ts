import { randomUUID } from "node:crypto";
import {
  claimMacCommands,
  macCommandResult,
  macCommandsWaiting,
  macListeningSince,
  markMacListening,
  queueMacCommand,
  withdrawMacCommand,
} from "@sidecar/database/models/mac-command-store";
import type { PlanStoreEffect } from "@sidecar/database/models/plan-store";
import {
  MAC_COMMAND_BOUNDS,
  type MacCommand,
  type MacCommandResult,
} from "@sidecar/hosted/mac-command-wire";
import { Clock, Duration, Effect, Option, Schedule } from "effect";
import type { SqlClient } from "effect/unstable/sql";

/**
 * mac-command.ts -- a shell command an agent runs on the developer's own Mac: queued for the account, run by a signed-in Mac that holds the read for it, and its result handed back to the call.
 *
 * Any agent may call it, the planning brain, a coding agent, and either's
 * workers, and nothing asks the developer first: Dean's call, with the one
 * brake a Settings switch on the Mac (`Let agents run commands on this
 * Mac`), which stops the Mac listening. The call refuses at once where no
 * Mac of the account listened lately, since nothing would take the command.
 * Otherwise it queues the command, looks for its result until the
 * command's own timeout and a grace for the Mac to answer have passed, and
 * withdraws the row whichever way it ends, so a row stands only while its
 * call does. The Mac's side is `GET /api/mac-commands`, held open while
 * nothing waits and answered with every waiting command claimed for it,
 * and `POST`, its result (`../mac-commands-app.ts`).
 */

export const MAC_COMMAND_SERVICE = {
  /** How long the Mac's read is held while nothing waits for it. */
  HOLD: Duration.seconds(20),
  /** How often a held read, and a call waiting on its result, looks again. */
  POLL: Duration.millis(500),
  /** How lately a Mac must have read for a call to count it listening: one hold, and room for the next read to arrive. */
  LISTENER_FRESH: Duration.seconds(45),
  /** How long past the command's own timeout a call waits for the Mac to say what it did. */
  ANSWER_GRACE: Duration.seconds(30),
} as const;

export const MAC_COMMAND_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

/** Why a call ran nothing, or never heard back, in words the model can act on. */
export const MAC_COMMAND_REFUSAL = {
  NO_MAC:
    "Not run: Luke is not running on the developer's Mac, or they switched off " +
    "Settings › Let agents run commands on this Mac.",
  NO_ANSWER:
    "No answer: the developer's Mac did not say what the command did in time; it may or may " +
    "not have run.",
  UNAVAILABLE: "Not run: the command could not be queued. The call may be made again.",
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type MacCommandAnswer =
  | ({ readonly status: typeof MAC_COMMAND_STATUS.RAN } & MacCommandResult)
  | { readonly status: typeof MAC_COMMAND_STATUS.NOT_RUN; readonly reason: string };

/** What a call asks: the shell text, and how long it may run, the default where unsaid. */
export interface MacCommandAsk {
  readonly command: string;
  readonly timeoutSeconds?: number;
}

function notRun(reason: string): MacCommandAnswer {
  return { status: MAC_COMMAND_STATUS.NOT_RUN, reason };
}

/** Whether a Mac of the account read for its commands within the freshness window. */
function macListening(userId: string): PlanStoreEffect<boolean> {
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
): PlanStoreEffect<Option.Option<MacCommandResult>> {
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
export function runOnMac(
  userId: string,
  ask: MacCommandAsk,
): Effect.Effect<MacCommandAnswer, never, SqlClient.SqlClient> {
  const queued: MacCommand = {
    id: randomUUID(),
    command: ask.command,
    timeoutSeconds: ask.timeoutSeconds ?? MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS,
  };
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
 * The Mac's held read: it is counted listening as the read arrives, and
 * answered with every waiting command claimed for it as soon as one waits,
 * or with none once the hold ends.
 */
export function macCommandsFor(userId: string): PlanStoreEffect<readonly MacCommand[]> {
  const grace = Duration.toSeconds(MAC_COMMAND_SERVICE.ANSWER_GRACE);
  return markMacListening(userId).pipe(
    Effect.andThen(
      macCommandsWaiting(userId, grace).pipe(
        Effect.repeat({ schedule: Schedule.spaced(MAC_COMMAND_SERVICE.POLL), until: (any) => any }),
        Effect.timeoutOption(MAC_COMMAND_SERVICE.HOLD),
      ),
    ),
    Effect.andThen(claimMacCommands(userId, grace)),
  );
}
