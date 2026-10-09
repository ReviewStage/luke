import { DRAW_ON_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { type DrawingElement, drawingElementsSchema } from "@sidecar/hosted/board-wire";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { layoutFindings } from "./board-layout.js";
import { writeDrawing } from "./board-store.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * board-tool.ts -- `draw_on_board`, the planning model's hand on the plan's whiteboard.
 *
 * The model sends the whole diagram each time, in the small vocabulary of
 * `board-wire.ts` (labelled boxes, ellipses, and diamonds, text, zones, and
 * arrows between ids), and it replaces the model's previous drawing. The
 * service only stores it: the developer's Mac converts it with Excalidraw's
 * own converter and puts it on the board in place of the previous one, beside
 * whatever the developer drew. A diagram that names an arrow's end the
 * drawing does not hold is refused, since the converter would drop the arrow
 * without a word. A drawn diagram's answer carries what is wrong with its
 * layout (`board-layout.ts`), since the model never sees the board and has no
 * other way to learn that two of its boxes overlap.
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
    "Not drawn: `elements` must be the whole diagram, each element in the tool's schema, every " +
    "id used once. The board is unchanged.",
  NO_END: "Not drawn: an arrow names an id the diagram does not hold. The board is unchanged.",
  NO_PLAN: "Not drawn: this plan no longer exists.",
  UNAVAILABLE:
    "Not drawn: the service could not reach its store. The board is unchanged; the call may be " +
    "made again.",
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type DrawOnBoardResult =
  | {
      readonly status: typeof DRAW_ON_BOARD_STATUS.DRAWN;
      readonly drawing: number;
      /** What is wrong with the drawing's layout; absent where nothing is. */
      readonly layout?: readonly string[];
    }
  | { readonly status: typeof DRAW_ON_BOARD_STATUS.NOT_DRAWN; readonly reason: string };

const DRAW_ON_BOARD_INPUT = Schema.Struct({ elements: drawingElementsSchema });

const readInput = readEither(DRAW_ON_BOARD_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const DRAW_ON_BOARD_TOOL = {
  name: DRAW_ON_BOARD_TOOL_NAME,
  description:
    "Draw a diagram on the plan's whiteboard, which the developer sees beside the plan and can " +
    "draw on too. Send the whole diagram every time: it replaces your previous drawing and " +
    "leaves what the developer drew. Boxes, ellipses, and diamonds take a label; a zone is a " +
    "dashed outline that groups shapes under a title; arrows join two ids. Coordinates are " +
    "pixels. Answers `drawn` with any layout problems under `layout`, which you fix by drawing " +
    "again, or why nothing was drawn.",
  inputSchema: DRAW_ON_BOARD_INPUT,
} as const;

const notDrawn = (reason: string): DrawOnBoardResult => ({
  status: DRAW_ON_BOARD_STATUS.NOT_DRAWN,
  reason,
});

/** Why a diagram cannot be drawn whole: an id used twice, or an arrow's end it does not hold. */
function refusalOf(elements: readonly DrawingElement[]): string | undefined {
  const ids = new Set(elements.map((element) => element.id));
  if (ids.size !== elements.length) return DRAW_ON_BOARD_REFUSAL.UNREADABLE;
  const ends = elements.flatMap((element) => ("from" in element ? [element.from, element.to] : []));
  return ends.every((end) => ids.has(end)) ? undefined : DRAW_ON_BOARD_REFUSAL.NO_END;
}

/** One call of `draw_on_board` under the plan the service bound, answered as the result the model reads. */
export function runDrawOnBoard(
  binding: BoardToolBinding,
  input: UnparsedWireValue,
): Effect.Effect<DrawOnBoardResult, never, SqlClient.SqlClient> {
  return Effect.suspend(() => {
    const read = readInput(input);
    if (Result.isFailure(read)) return Effect.succeed(notDrawn(DRAW_ON_BOARD_REFUSAL.UNREADABLE));
    const refusal = refusalOf(read.success.elements);
    if (refusal !== undefined) return Effect.succeed(notDrawn(refusal));
    return writeDrawing(binding.userId, binding.planId, read.success.elements).pipe(
      Effect.map((written) =>
        Option.match(written, {
          onNone: () => notDrawn(DRAW_ON_BOARD_REFUSAL.NO_PLAN),
          onSome: (board): DrawOnBoardResult => {
            const drawing = board.drawing?.number ?? 0;
            const layout = layoutFindings(read.success.elements, board.elements);
            const drawn = { status: DRAW_ON_BOARD_STATUS.DRAWN, drawing };
            return layout.length === 0 ? drawn : { ...drawn, layout };
          },
        }),
      ),
      Effect.tapError(logStoreFailure),
      Effect.catch(() => Effect.succeed(notDrawn(DRAW_ON_BOARD_REFUSAL.UNAVAILABLE))),
    );
  });
}
