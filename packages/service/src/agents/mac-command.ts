import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  claimMacCommand,
  claimMacCommands,
  macCommandResult,
  macCommandsWaiting,
  macListeningSince,
  macOwnerOf,
  markMacListening,
  queueMacCommand,
  withdrawMacCommand,
} from "@repo/database/models/mac-command-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import {
  MAC_COMMAND_BOUNDS,
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
  type MacShellResult,
  macCommandSchema,
} from "@repo/features/mac-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Clock, Duration, Effect, Option, Result, Schema } from "effect";
import { heldUntil } from "../http/held-read.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { COMMAND_DESCRIPTION } from "./command-description.js";

const MAC_COMMAND_SERVICE = {
  HOLD: Duration.seconds(20),
  POLL: Duration.millis(500),
  LISTENER_FRESH: Duration.seconds(45),
  CLAIM_WINDOW: Duration.seconds(30),
  ANSWER_GRACE: Duration.seconds(35),
} as const;

export const MAC_COMMAND_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

const MAC_COMMAND_REFUSAL = {
  NO_MAC:
    `Not run: ${PRODUCT_NAME} is not running on the developer's Mac, or they switched off ` +
    "Settings › Let agents run commands on this Mac.",
  NO_ANSWER:
    "No answer: the developer's Mac did not say what the command did in time; it may or may " +
    "not have run.",
  UNAVAILABLE: "Not run: the command could not be queued. The call may be made again.",
  UNREADABLE:
    "Not run: `command` must be one non-empty shell command, and `timeout_seconds` a whole " +
    `number from 1 to ${MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS}.`,
} as const;

const MAC_COMMAND_KIND_REFUSAL = {
  [MAC_COMMAND_KIND.SHELL]: {
    NO_MAC: MAC_COMMAND_REFUSAL.NO_MAC,
    UNREADABLE: MAC_COMMAND_REFUSAL.UNREADABLE,
  },
} as const satisfies Record<
  MacCommandKind,
  { readonly NO_MAC: string; readonly UNREADABLE: string }
>;

export type MacCommandAnswer =
  | ({ readonly status: typeof MAC_COMMAND_STATUS.RAN } & MacShellResult)
  | { readonly status: typeof MAC_COMMAND_STATUS.NOT_RUN; readonly reason: string };

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

export const RUN_ON_MAC_TOOL = {
  name: AGENT_TOOL.RUN_ON_MAC,
  description:
    "Run one shell command on the developer's own Mac, in their login shell from their home " +
    "folder, and read what it printed. The developer's Mac may ask them first, and they may " +
    "decline, in which case the call answers `not-run`. It reaches whatever the developer's account on the Mac reaches: their local checkouts and " +
    "uncommitted work, installed tools, running servers. Use it for what only the Mac has; " +
    "read the task's repository where you have it. Nothing reads stdin, so a command that asks " +
    `for input fails. It is killed after ${MAC_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS} seconds ` +
    "unless `timeout_seconds` says otherwise. Answers the exit code, stdout, and stderr, each " +
    `cut to ${MAC_COMMAND_BOUNDS.MAX_OUTPUT_CHARS} characters, or \`not-run\` and why, such as ` +
    `${PRODUCT_NAME} not running on the Mac.`,
  inputSchema: RUN_ON_MAC_INPUT,
} as const;

function notRun(reason: string): MacCommandAnswer {
  return { status: MAC_COMMAND_STATUS.NOT_RUN, reason };
}

export function macListening(userId: string): TaskStoreEffect<boolean> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    macListeningSince(
      userId,
      new Date(now - Duration.toMillis(MAC_COMMAND_SERVICE.LISTENER_FRESH)),
    ),
  );
}

function answered(result: MacCommandResult): MacCommandAnswer {
  if ("refused" in result) return notRun(result.refused);
  return { status: MAC_COMMAND_STATUS.RAN, ...result };
}

function commandTopics(userId: string): readonly SyncTopic[] {
  return [[TOPIC.ACCOUNT, userId]];
}

function awaitedResult(
  userId: string,
  queued: MacCommand,
): TaskStoreEffect<Option.Option<MacCommandResult>> {
  const deadline = Duration.sum(
    Duration.seconds(queued.timeoutSeconds),
    MAC_COMMAND_SERVICE.ANSWER_GRACE,
  );
  return Effect.map(
    heldUntil(
      macCommandResult(userId, queued.id),
      Option.isSome,
      commandTopics(userId),
      MAC_COMMAND_SERVICE.POLL,
      deadline,
    ),
    (held) => Option.flatMap(held, ({ read }) => read),
  );
}

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
    const owner = yield* Effect.result(macOwnerOf(target));
    if (Result.isFailure(owner)) return notRun(MAC_COMMAND_REFUSAL.UNAVAILABLE);
    return yield* askMac(owner.success, ask);
  });
}

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
      heldUntil(
        Effect.flatMap(queuedSince, (since) => macCommandsWaiting(userId, since, kinds)),
        (any) => any,
        commandTopics(userId),
        MAC_COMMAND_SERVICE.POLL,
        MAC_COMMAND_SERVICE.HOLD,
      ),
    ),
    Effect.andThen(Effect.flatMap(queuedSince, (since) => claimMacCommands(userId, since, kinds))),
  );
}
