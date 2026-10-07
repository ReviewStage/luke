import { applyBoardOps, type BoardOp, boardOpsInputSchema } from "@sidecar/hosted/board-skeleton";
import { boardText } from "@sidecar/hosted/board-text";
import { BOARD_AUTHOR } from "@sidecar/hosted/board-wire";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { DateTime, Effect, Option, Result } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { BOARD_WRITE, readBoard, writeBoard } from "./board-store.js";
import type { PlanStoreEffect } from "./plan-store.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * board-tool.ts -- `draw_on_board`, the planning model's hand on the plan's whiteboard.
 *
 * The model sends operations in `board-skeleton.ts`'s vocabulary (add a
 * labelled box, an arrow between two ids, a line of text; update, remove,
 * clear), and the service applies them to the board as it stands and writes
 * the result as the next revision. The answer carries the board as the model
 * reads it (`board-text.ts`), so it sees at once what it drew and the ids it
 * can name next.
 *
 * Note that the account and plan it draws on are the binding the service
 * built from the conversation's plan, never an argument, exactly as
 * `update_plan`'s are. The developer may be drawing at the same moment, so a
 * write over a board that moved is applied once more to the board as it now
 * stands; a second conflict answers not drawn, and the model may call again.
 * Every outcome is a result the model reads, never a failure of the call.
 */

/** The account and plan a planning conversation draws on, fixed by the service before the model runs. */
interface BoardToolBinding {
  readonly userId: string;
  readonly planId: string;
}

export const DRAW_ON_BOARD_STATUS = {
  DRAWN: "drawn",
  NOT_DRAWN: "not-drawn",
} as const;

/** Why a call drew nothing, in words the model can act on. */
const DRAW_ON_BOARD_REFUSAL = {
  UNREADABLE:
    "Not drawn: `operations` must be a list of add, update, remove, or clear operations in the " +
    "tool's schema. The board is unchanged.",
  BUSY: "Not drawn: the developer kept changing the board while you drew. The call may be made again.",
  NO_PLAN: "Not drawn: this plan no longer exists.",
  UNAVAILABLE:
    "Not drawn: the service could not reach its store. The board is unchanged; the call may be " +
    "made again.",
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type DrawOnBoardResult =
  | {
      readonly status: typeof DRAW_ON_BOARD_STATUS.DRAWN;
      readonly revision: number;
      /** The board as it now stands, in the form the standing context carries. */
      readonly board: string;
    }
  | {
      readonly status: typeof DRAW_ON_BOARD_STATUS.NOT_DRAWN;
      readonly reason: string;
      /** The position in `operations` of the one refused, where one was. */
      readonly operation?: number;
    };

/** How many times a draw is applied over a board the developer moved before it gives up. */
const MAXIMUM_ATTEMPTS = 2;

const readInput = readEither(boardOpsInputSchema);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const DRAW_ON_BOARD_TOOL = {
  name: "draw_on_board",
  description:
    "Draw on the plan's whiteboard, which the developer sees beside the plan and can draw on " +
    "too. Add boxes, ellipses, and diamonds with labels, arrows between them by id, free text, " +
    "and lines; update, remove, or clear. Removing a shape removes its arrows. Coordinates are " +
    "pixels: lay boxes about 200x80 with 80px or more between them. Answers the board as it now " +
    "stands, or why nothing was drawn.",
  inputSchema: boardOpsInputSchema,
} as const;

const notDrawn = (reason: string, operation?: number): DrawOnBoardResult =>
  operation === undefined
    ? { status: DRAW_ON_BOARD_STATUS.NOT_DRAWN, reason }
    : { status: DRAW_ON_BOARD_STATUS.NOT_DRAWN, reason, operation };

/** The operations applied over the board as it stands and written, once more over a board that moved meanwhile. */
function draw(
  binding: BoardToolBinding,
  ops: readonly BoardOp[],
  attempt: number,
): PlanStoreEffect<DrawOnBoardResult> {
  return Effect.gen(function* () {
    const standing = yield* readBoard(binding.userId, binding.planId);
    if (Option.isNone(standing)) return notDrawn(DRAW_ON_BOARD_REFUSAL.NO_PLAN);
    const now = yield* DateTime.now;
    const drawn = applyBoardOps(standing.value.elements, ops, DateTime.toEpochMillis(now));
    if (Result.isFailure(drawn)) return notDrawn(drawn.failure.reason, drawn.failure.at);
    const written = yield* writeBoard(
      binding.userId,
      binding.planId,
      standing.value.revision,
      drawn.success,
      BOARD_AUTHOR.LUKE,
    );
    switch (written.outcome) {
      case BOARD_WRITE.SAVED:
        return {
          status: DRAW_ON_BOARD_STATUS.DRAWN,
          revision: written.board.revision,
          board: boardText(written.board),
        } as const;
      case BOARD_WRITE.CONFLICT:
        if (attempt + 1 < MAXIMUM_ATTEMPTS) return yield* draw(binding, ops, attempt + 1);
        return notDrawn(DRAW_ON_BOARD_REFUSAL.BUSY);
      case BOARD_WRITE.NO_PLAN:
        return notDrawn(DRAW_ON_BOARD_REFUSAL.NO_PLAN);
    }
  });
}

/** One call of `draw_on_board` under the plan the service bound, answered as the result the model reads. */
export function runDrawOnBoard(
  binding: BoardToolBinding,
  input: UnparsedWireValue,
): Effect.Effect<DrawOnBoardResult, never, SqlClient.SqlClient> {
  return Effect.suspend(() => {
    const read = readInput(input);
    if (Result.isFailure(read)) return Effect.succeed(notDrawn(DRAW_ON_BOARD_REFUSAL.UNREADABLE));
    return draw(binding, read.success.operations, 0).pipe(
      Effect.tapError(logStoreFailure),
      Effect.catch(() => Effect.succeed(notDrawn(DRAW_ON_BOARD_REFUSAL.UNAVAILABLE))),
    );
  });
}
