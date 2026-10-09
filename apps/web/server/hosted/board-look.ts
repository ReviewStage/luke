import {
  type BoardLook,
  type BoardLookResult,
  boardLookResultSchema,
} from "@sidecar/hosted/board-wire";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schedule, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { ToolModelOutput } from "eve/tools";
import { plan, planBoardLook } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import type { PlanDocumentBinding } from "./plan-notes.js";

/**
 * board-look.ts -- `look_at_board`, the planning model's eyes on the plan's whiteboard: the board as the developer's Mac draws it, handed back as an image.
 *
 * Excalidraw's own guides for a model that draws ask it to look at what it
 * drew and fix what it sees before it moves on: text cut off, shapes on top
 * of one another, an arrow through a shape. `draw_on_board`'s layout findings
 * (`board-layout.ts`) catch what coordinates show; only a picture shows the
 * rest, and only the Mac can draw one, since its canvas is what measures the
 * text and places Luke's drawing beside the developer's. So a look is a
 * `plan_board_look` row, on the same terms as `run_in_repository`'s
 * commands (`repository-shell.ts`): the tool inserts it and reads it until
 * the Mac answers, and the Mac, while the plan is open, claims the oldest
 * through a long poll, draws the board, and settles it with the PNG.
 *
 * Note that a look waits a short while, not a command's minute: a Mac that
 * predates looks never claims one, and the model, mid-conversation, is
 * better told at once that it cannot see. A claim takes only a look still
 * inside that wait, so a Mac that comes back late does not draw for a tool
 * that already gave up.
 *
 * The image reaches the model as an image (`lookModelOutput`), never as its
 * base64 spelled out as text, and stays out of the conversation's stored
 * messages (`storedLookOutput`): what the model saw once is no record of the
 * plan, and a board's picture is hundreds of kilobytes.
 */

/** Why a call shows nothing, in words the model can act on. */
export const LOOK_AT_BOARD_REFUSAL = {
  UNREADABLE: "Not looked: the tool takes no arguments.",
  NO_ANSWER:
    "Not looked: Luke's Mac did not draw the board in time. Do not look again this turn; rely " +
    "on draw_on_board's layout findings.",
  FAILED: "Not looked: the look could not be handed to Luke's Mac. The call may be made again.",
} as const;

export const LOOK_AT_BOARD_STATUS = {
  LOOKED: "looked",
  NOT_LOOKED: "not-looked",
} as const;

/** How long each side waits on the other. */
export const BOARD_LOOK_WAIT = {
  /** How often the tool reads its row for the Mac's answer. */
  RESULT_POLL: Duration.millis(250),
  /** How long the tool waits for the Mac before it answers `not-looked`, and how old a look may be to be claimed. */
  RESULT_DEADLINE: Duration.seconds(20),
  /** How often a held claim looks for a new row. */
  CLAIM_POLL: Duration.millis(100),
  /** How long a claim is held open before it answers none, well inside the function's own duration. */
  CLAIM_HOLD: Duration.seconds(20),
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type LookAtBoardResult =
  | { readonly status: typeof LOOK_AT_BOARD_STATUS.LOOKED; readonly image: string }
  | { readonly status: typeof LOOK_AT_BOARD_STATUS.NOT_LOOKED; readonly reason: string };

type BoardLookEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

const LOOK_AT_BOARD_INPUT = Schema.Struct({});

/** Whether a call's arguments are the none the tool takes. Note that an empty struct admits any key, so this counts them. */
function takesNothing(input: UnparsedWireValue): boolean {
  return isRecord(input) && Object.keys(input).length === 0;
}

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const LOOK_AT_BOARD_TOOL = {
  name: "look_at_board",
  description:
    "See the plan's whiteboard as the developer sees it: an image of the whole board, your " +
    "drawing and theirs. Look after you draw, and check that every label is whole, nothing " +
    "overlaps, and no arrow crosses a shape it does not join; then fix what you see by drawing " +
    "again. Answers the image, or `not-looked` and why.",
  inputSchema: LOOK_AT_BOARD_INPUT,
} as const;

const LOOK_MEDIA_TYPE = "image/png";

/** A settled look's result, as the model's and the store's views of it read one. */
const isLooked = Schema.is(
  Schema.Struct({ status: Schema.Literal(LOOK_AT_BOARD_STATUS.LOOKED), image: Schema.String }),
);

const insertLook = SqlSchema.findOne({
  Request: Schema.Struct({ planId: Schema.String, createdAt: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (write) => db.insert(planBoardLook).values(write).returning({ id: planBoardLook.id }),
});

const findResult = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ result: Schema.NullOr(boardLookResultSchema) }),
  execute: (id) =>
    db.select({ result: planBoardLook.result }).from(planBoardLook).where(eq(planBoardLook.id, id)),
});

/** The account's plan under this id, as a subquery a look's `plan_id` is matched against. */
function ownedPlanIds(userId: string, planId: string) {
  return db
    .select({ id: plan.id })
    .from(plan)
    .where(and(eq(plan.id, planId), eq(plan.userId, userId)));
}

const claimOldest = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    now: Schema.Date,
    since: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, planId, now, since }) => {
    const oldest = db
      .select({ id: planBoardLook.id })
      .from(planBoardLook)
      .where(
        and(
          inArray(planBoardLook.planId, ownedPlanIds(userId, planId)),
          isNull(planBoardLook.claimedAt),
          gt(planBoardLook.createdAt, since),
        ),
      )
      .orderBy(asc(planBoardLook.createdAt))
      .limit(1);
    // Note that the outer `claimed_at is null` is what makes two racing claims settle on one winner.
    return db
      .update(planBoardLook)
      .set({ claimedAt: now })
      .where(and(inArray(planBoardLook.id, oldest), isNull(planBoardLook.claimedAt)))
      .returning({ id: planBoardLook.id });
  },
});

const settleClaimed = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    lookId: Schema.String,
    result: boardLookResultSchema,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, planId, lookId, result }) =>
    db
      .update(planBoardLook)
      .set({ result })
      .where(
        and(
          eq(planBoardLook.id, lookId),
          inArray(planBoardLook.planId, ownedPlanIds(userId, planId)),
          isNull(planBoardLook.result),
        ),
      )
      .returning({ id: planBoardLook.id }),
});

/**
 * The oldest unclaimed look of the account's plan still inside the tool's
 * wait, claimed, held open up to `CLAIM_HOLD` until one arrives; none when
 * the hold ran out.
 */
export function claimBoardLook(userId: string, planId: string): BoardLookEffect<BoardLook | null> {
  const claim = Effect.flatMap(DateTime.now, (now) =>
    claimOldest({
      userId,
      planId,
      now: DateTime.toDateUtc(now),
      since: DateTime.toDateUtc(DateTime.subtractDuration(now, BOARD_LOOK_WAIT.RESULT_DEADLINE)),
    }),
  );
  return claim.pipe(
    Effect.repeat({
      schedule: Schedule.spaced(BOARD_LOOK_WAIT.CLAIM_POLL),
      until: Option.isSome,
    }),
    Effect.timeoutOption(BOARD_LOOK_WAIT.CLAIM_HOLD),
    Effect.map((claimed) => Option.getOrNull(Option.flatten(claimed))),
  );
}

/** The Mac's answer to a look of the account's plan; false when no such unsettled look stands. */
export function settleBoardLook(
  userId: string,
  planId: string,
  lookId: string,
  result: BoardLookResult,
): BoardLookEffect<boolean> {
  return Effect.map(settleClaimed({ userId, planId, lookId, result }), (rows) => rows.length > 0);
}

/** What the model reads for a settled look: the image, or the Mac's reason there is none. */
function resultOf(answered: BoardLookResult): LookAtBoardResult {
  return "image" in answered
    ? { status: LOOK_AT_BOARD_STATUS.LOOKED, image: answered.image }
    : { status: LOOK_AT_BOARD_STATUS.NOT_LOOKED, reason: `Not looked: ${answered.failure}` };
}

/**
 * One call of `look_at_board`: a look queued for the Mac, and the board it
 * drew once it lands, or `not-looked` when none did by the deadline.
 */
export function runLookAtBoard(
  binding: PlanDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<LookAtBoardResult, never, SqlClient.SqlClient> {
  const looked: BoardLookEffect<LookAtBoardResult> = Effect.gen(function* () {
    if (!takesNothing(input)) {
      return { status: LOOK_AT_BOARD_STATUS.NOT_LOOKED, reason: LOOK_AT_BOARD_REFUSAL.UNREADABLE };
    }
    // Note that the look is stamped on the same clock a claim reads its age by.
    const createdAt = DateTime.toDateUtc(yield* DateTime.now);
    const queued = yield* insertLook({ planId: binding.planId, createdAt }).pipe(
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    const answered = yield* findResult(queued.id).pipe(
      Effect.map((row) => Option.flatMap(row, ({ result }) => Option.fromNullishOr(result))),
      Effect.repeat({
        schedule: Schedule.spaced(BOARD_LOOK_WAIT.RESULT_POLL),
        until: Option.isSome,
      }),
      Effect.timeoutOption(BOARD_LOOK_WAIT.RESULT_DEADLINE),
      Effect.map(Option.flatten),
    );
    if (Option.isNone(answered)) {
      return { status: LOOK_AT_BOARD_STATUS.NOT_LOOKED, reason: LOOK_AT_BOARD_REFUSAL.NO_ANSWER };
    }
    return resultOf(answered.value);
  });
  return Effect.catch(looked, () =>
    Effect.succeed({
      status: LOOK_AT_BOARD_STATUS.NOT_LOOKED,
      reason: LOOK_AT_BOARD_REFUSAL.FAILED,
    }),
  );
}

/**
 * What the model is shown of a call's result: a look's image as an image, and
 * anything else as the JSON it is. Note that the output is eve's literal
 * shape, spelled here rather than built with eve's helpers, because this
 * module is in every function's bundle and eve's runtime belongs in none.
 */
export function lookModelOutput(output: UnparsedWireValue): ToolModelOutput {
  if (!isLooked(output)) return { type: "json", value: output };
  return {
    type: "content",
    value: [
      { type: "text", text: "The plan's whiteboard as the developer sees it now:" },
      { type: "file", data: { type: "data", data: output.image }, mediaType: LOOK_MEDIA_TYPE },
    ],
  };
}

/** A call's result as the conversation keeps it: a look's status without its image. */
export function storedLookOutput(output: UnparsedWireValue): UnparsedWireValue {
  return isLooked(output) ? unparsedWire({ status: output.status }) : output;
}
