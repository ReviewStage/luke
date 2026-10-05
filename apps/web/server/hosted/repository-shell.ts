import {
  type PlanCommand,
  type PlanCommandResult,
  planCommandResultSchema,
} from "@sidecar/hosted/plan-wire";
import type { UnparsedWireValue } from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Result, Schedule, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { plan, planCommand } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import type { PlanDocumentBinding } from "./update-plan-tool.js";

/**
 * repository-shell.ts -- the planning model's one source read: a shell command run on the developer's Mac, in the plan's folder.
 *
 * The planning model runs here and the folder is on the Mac, which only ever
 * calls in. So a call is a `plan_command` row: the tool inserts it and reads
 * it until the Mac has answered, and the Mac, while the plan is open in its
 * Plans panel, claims the oldest unclaimed row through a long poll
 * (`claimPlanCommand`), runs it, and settles it (`settlePlanCommand`). Every
 * claim and settle names the account beside the plan, so another account's
 * plan answers as none.
 */

/** Why a call ran nothing, in words the model can act on. */
export const REPOSITORY_SHELL_REFUSAL = {
  UNREADABLE: "Not run: the arguments must be exactly `command`, one shell command.",
  NO_ANSWER:
    "Not run: Luke's Mac did not answer. Luke must be open on this plan on the developer's Mac. " +
    "The call may be made again.",
  FAILED: "Not run: the command could not be handed to Luke's Mac. The call may be made again.",
} as const;

export const REPOSITORY_SHELL_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

/** How long each side waits on the other. */
export const PLAN_COMMAND_WAIT = {
  /** How often the tool reads its row for the Mac's answer. */
  RESULT_POLL: Duration.millis(250),
  /** How long the tool waits for the Mac before it answers `not-run`. */
  RESULT_DEADLINE: Duration.seconds(60),
  /** How often a held claim looks for a new row. */
  CLAIM_POLL: Duration.millis(100),
  /** How long a claim is held open before it answers none, well inside the function's own duration. */
  CLAIM_HOLD: Duration.seconds(20),
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type RepositoryShellResult =
  | ({ readonly status: typeof REPOSITORY_SHELL_STATUS.RAN } & PlanCommandResult)
  | { readonly status: typeof REPOSITORY_SHELL_STATUS.NOT_RUN; readonly reason: string };

type PlanCommandEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

const RUN_IN_REPOSITORY_INPUT = Schema.Struct({
  command: describeWire(
    Schema.String.check(Schema.isMinLength(1)),
    'One bash command, run from the plan\'s folder, such as "ls", "grep -rn invite src", ' +
      'or "cat package.json".',
  ),
});

const readInput = readEither(RUN_IN_REPOSITORY_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const RUN_IN_REPOSITORY_TOOL = {
  name: "run_in_repository",
  description:
    "Run one bash command in the plan's folder on the developer's Mac, from the folder root. " +
    "Use it to explore: ls, find, grep, cat, git log. " +
    "Answers the exit code, stdout, and stderr, or `not-run` and why.",
  inputSchema: RUN_IN_REPOSITORY_INPUT,
} as const;

const insertCommand = SqlSchema.findOne({
  Request: Schema.Struct({ planId: Schema.String, command: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (write) => db.insert(planCommand).values(write).returning({ id: planCommand.id }),
});

const findResult = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ result: Schema.NullOr(planCommandResultSchema) }),
  execute: (id) =>
    db.select({ result: planCommand.result }).from(planCommand).where(eq(planCommand.id, id)),
});

/** The account's plan under this id, as a subquery a command's `plan_id` is matched against. */
function ownedPlanIds(userId: string, planId: string) {
  return db
    .select({ id: plan.id })
    .from(plan)
    .where(and(eq(plan.id, planId), eq(plan.userId, userId)));
}

const claimOldest = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String, command: Schema.String }),
  execute: ({ userId, planId, now }) => {
    const oldest = db
      .select({ id: planCommand.id })
      .from(planCommand)
      .where(
        and(
          inArray(planCommand.planId, ownedPlanIds(userId, planId)),
          isNull(planCommand.claimedAt),
        ),
      )
      .orderBy(asc(planCommand.createdAt))
      .limit(1);
    // Note that the outer `claimed_at is null` is what makes two racing claims settle on one winner.
    return db
      .update(planCommand)
      .set({ claimedAt: now })
      .where(and(inArray(planCommand.id, oldest), isNull(planCommand.claimedAt)))
      .returning({ id: planCommand.id, command: planCommand.command });
  },
});

const settleClaimed = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    commandId: Schema.String,
    result: planCommandResultSchema,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, planId, commandId, result }) =>
    db
      .update(planCommand)
      .set({ result })
      .where(
        and(
          eq(planCommand.id, commandId),
          inArray(planCommand.planId, ownedPlanIds(userId, planId)),
          isNull(planCommand.result),
        ),
      )
      .returning({ id: planCommand.id }),
});

/**
 * The oldest unclaimed command of the account's plan, claimed, held open up to
 * `CLAIM_HOLD` until one arrives; none when the hold ran out.
 */
export function claimPlanCommand(
  userId: string,
  planId: string,
): PlanCommandEffect<PlanCommand | null> {
  const claim = Effect.flatMap(DateTime.nowAsDate, (now) => claimOldest({ userId, planId, now }));
  return claim.pipe(
    Effect.repeat({
      schedule: Schedule.spaced(PLAN_COMMAND_WAIT.CLAIM_POLL),
      until: Option.isSome,
    }),
    Effect.timeoutOption(PLAN_COMMAND_WAIT.CLAIM_HOLD),
    Effect.map((claimed) => Option.getOrNull(Option.flatten(claimed))),
  );
}

/** The Mac's answer to a command of the account's plan; false when no such unsettled command stands. */
export function settlePlanCommand(
  userId: string,
  planId: string,
  commandId: string,
  result: PlanCommandResult,
): PlanCommandEffect<boolean> {
  return Effect.map(
    settleClaimed({ userId, planId, commandId, result }),
    (rows) => rows.length > 0,
  );
}

/**
 * One call of `run_in_repository`: the command queued for the Mac in the
 * plan's folder, and the Mac's answer once it lands, or `not-run` when none
 * did by the deadline.
 */
export function runInRepository(
  binding: PlanDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<RepositoryShellResult, never, SqlClient.SqlClient> {
  const ran: PlanCommandEffect<RepositoryShellResult> = Effect.gen(function* () {
    const read = readInput(input);
    if (Result.isFailure(read)) {
      return {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.UNREADABLE,
      };
    }
    const queued = yield* insertCommand({
      planId: binding.planId,
      command: read.success.command,
    }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
    const answered = yield* findResult(queued.id).pipe(
      Effect.map((row) => Option.flatMap(row, ({ result }) => Option.fromNullishOr(result))),
      Effect.repeat({
        schedule: Schedule.spaced(PLAN_COMMAND_WAIT.RESULT_POLL),
        until: Option.isSome,
      }),
      Effect.timeoutOption(PLAN_COMMAND_WAIT.RESULT_DEADLINE),
      Effect.map(Option.flatten),
    );
    if (Option.isNone(answered)) {
      return {
        status: REPOSITORY_SHELL_STATUS.NOT_RUN,
        reason: REPOSITORY_SHELL_REFUSAL.NO_ANSWER,
      };
    }
    return { status: REPOSITORY_SHELL_STATUS.RAN, ...answered.value };
  });
  return Effect.catch(ran, () =>
    Effect.succeed({
      status: REPOSITORY_SHELL_STATUS.NOT_RUN,
      reason: REPOSITORY_SHELL_REFUSAL.FAILED,
    }),
  );
}
