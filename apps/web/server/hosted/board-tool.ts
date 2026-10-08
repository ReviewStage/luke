import { DRAWING_FAULT, type DrawingFault, StandingBoard } from "@sidecar/hosted/board-drawing";
import { DRAW_ON_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { drawingStepsSchema } from "@sidecar/hosted/board-wire";
import type { UnparsedWireValue } from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { addDrawing } from "./board-store.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * board-tool.ts -- `draw_on_board`, the planning model's hand on the plan's whiteboard.
 *
 * The model draws in the small vocabulary of `board-wire.ts`, after
 * Excalidraw's own format for agents: labelled boxes, ellipses, and diamonds,
 * text, arrows between ids, `delete`, and `cameraUpdate`. A drawing replaces
 * the model's previous elements, or with `restore` draws on the board as it
 * stands, the developer's edits to the model's elements kept. The service
 * only stores it: the developer's Mac converts it with Excalidraw's own
 * converter and puts it on the board beside whatever the developer drew. A
 * drawing the Mac could not apply whole is refused (`board-drawing.ts`),
 * since the canvas would drop an arrow without an end without a word.
 *
 * Note that the account and plan it draws on are the binding the service
 * built from the conversation's plan, never an argument, exactly as
 * `update_plan`'s are. Every outcome is a result the model reads, never a
 * failure of the call.
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
export const DRAW_ON_BOARD_REFUSAL = {
  UNREADABLE:
    "Not drawn: `elements` must be the drawing's steps, each in the tool's schema. The board is " +
    "unchanged.",
  [DRAWING_FAULT.TAKEN_ID]:
    "Not drawn: an element's id is already on the board or used twice. To change one of your " +
    "elements, `delete` it earlier in the same drawing and draw it again. The board is unchanged.",
  [DRAWING_FAULT.NOT_LUKES]:
    "Not drawn: `delete` names an id that is not one of your elements on the board; only " +
    "elements marked (yours) can be deleted. The board is unchanged.",
  [DRAWING_FAULT.NO_END]:
    "Not drawn: an arrow names an id that is not a shape or text in this drawing or on the " +
    "board. The board is unchanged.",
  NO_PLAN: "Not drawn: this plan no longer exists.",
  UNAVAILABLE:
    "Not drawn: the service could not reach its store. The board is unchanged; the call may be " +
    "made again.",
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type DrawOnBoardResult =
  | { readonly status: typeof DRAW_ON_BOARD_STATUS.DRAWN; readonly drawing: number }
  | { readonly status: typeof DRAW_ON_BOARD_STATUS.NOT_DRAWN; readonly reason: string };

const DRAW_ON_BOARD_INPUT = Schema.Struct({
  restore: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true: draw on the board as it stands, your earlier elements kept as the developer left " +
        "them. Left out or false: your earlier elements are taken off first.",
    ),
  ),
  elements: drawingStepsSchema,
});

const readInput = readEither(DRAW_ON_BOARD_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const DRAW_ON_BOARD_TOOL = {
  name: DRAW_ON_BOARD_TOOL_NAME,
  description:
    "Draw on the plan's whiteboard, an Excalidraw canvas the developer sees beside the plan and " +
    "can draw on too. Without `restore`, the drawing replaces your earlier elements; with " +
    "`restore: true` it adds to the board as it stands, and `delete` takes your elements off. " +
    "What the developer drew always stays. Follow the whiteboard guide in your instructions. " +
    "Answers `drawn`, or why nothing was drawn.",
  inputSchema: DRAW_ON_BOARD_INPUT,
} as const;

const notDrawn = (reason: string): DrawOnBoardResult => ({
  status: DRAW_ON_BOARD_STATUS.NOT_DRAWN,
  reason,
});

/** One call of `draw_on_board` under the plan the service bound, answered as the result the model reads. */
export function runDrawOnBoard(
  binding: BoardToolBinding,
  input: UnparsedWireValue,
): Effect.Effect<DrawOnBoardResult, never, SqlClient.SqlClient> {
  return Effect.suspend(() => {
    const read = readInput(input);
    if (Result.isFailure(read)) return Effect.succeed(notDrawn(DRAW_ON_BOARD_REFUSAL.UNREADABLE));
    const request = { restore: read.success.restore ?? false, elements: read.success.elements };
    return addDrawing(binding.userId, binding.planId, request, (board) =>
      StandingBoard.of(board).refusalOf(request),
    ).pipe(
      Effect.map((written) =>
        Option.match(written, {
          onNone: () => notDrawn(DRAW_ON_BOARD_REFUSAL.NO_PLAN),
          onSome: Result.match({
            onFailure: (fault: DrawingFault) => notDrawn(DRAW_ON_BOARD_REFUSAL[fault]),
            onSuccess: (board): DrawOnBoardResult => ({
              status: DRAW_ON_BOARD_STATUS.DRAWN,
              drawing: board.latestDrawing,
            }),
          }),
        }),
      ),
      Effect.tapError(logStoreFailure),
      Effect.catch(() => Effect.succeed(notDrawn(DRAW_ON_BOARD_REFUSAL.UNAVAILABLE))),
    );
  });
}
