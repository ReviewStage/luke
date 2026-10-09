import { type Board, boardSchema } from "@sidecar/hosted/board-wire";
import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";

/**
 * board-render.ts -- what main asks the Plans panel to draw for the planning model's look at a board, and how the panel reads it.
 *
 * The panel answers with `PLANNING_BOARD_RENDERED`, naming the request's id,
 * so main can tell which look the image is for (`main/ipc/board-renderer.ts`).
 */

/** One board to draw, under the id the panel's reply names. */
export interface BoardRenderRequest {
  readonly requestId: string;
  readonly board: Board;
}

const readBoard = readEither(boardSchema);

/** Whether a value crossing into the panel is a render request, its board read as a board. */
export function isBoardRenderRequest(value: UnparsedWireValue): boolean {
  return (
    isRecord(value) &&
    isWireString(value.requestId) &&
    Result.isSuccess(readBoard(value.board ?? null))
  );
}
