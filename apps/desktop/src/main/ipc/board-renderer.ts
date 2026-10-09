import { randomUUID } from "node:crypto";
import type { Board, BoardLookResult } from "@sidecar/hosted/board-wire";
import { Deferred, Duration, Effect, Option } from "effect";
import type { BoardRenderRequest } from "#shared/messages/board-render";

/**
 * board-renderer.ts -- the planning model's look at a board, drawn by the Plans panel: main asks the panel, and waits for the image it answers.
 *
 * Only a window can draw, and only the panel's whiteboard bundle draws a
 * board as the developer sees it, so a look the host asks for
 * (`HOST_NODE_CAPABILITY.RENDER_BOARD`) is handed to the panel as a request
 * with an id of its own (`onBoardRender`), and the panel's reply act
 * (`PLANNING_BOARD_RENDERED`) settles the request of that id. A request the
 * panel did not answer in `RENDER_DEADLINE`, or with no panel to ask, answers
 * why rather than waiting for ever, and a reply nobody is waiting for is
 * dropped.
 */

/** How long the panel may take to load Excalidraw and draw a board. */
const RENDER_DEADLINE = Duration.seconds(10);

const RENDER_FAILURE = {
  NO_PANEL: "the Plans panel is not open on the developer's Mac.",
  NO_ANSWER: "the Plans panel did not draw the board in time.",
} as const;

export interface BoardRenderer {
  /** Where requests go: to the panel, answering whether one was there to take it. Set once the windows exist. */
  link: (send: (request: BoardRenderRequest) => boolean) => void;
  /** One board drawn by the panel; every outcome is a result. */
  render: (board: Board) => Effect.Effect<BoardLookResult>;
  /** The panel's reply to the request of this id; false when nothing waits on it. */
  settle: (requestId: string, result: BoardLookResult) => boolean;
}

export function createBoardRenderer(): BoardRenderer {
  const pending = new Map<string, Deferred.Deferred<BoardLookResult>>();
  let send: ((request: BoardRenderRequest) => boolean) | undefined;

  const render = (board: Board): Effect.Effect<BoardLookResult> =>
    Effect.suspend(() => {
      const requestId = randomUUID();
      const answered = Deferred.makeUnsafe<BoardLookResult>();
      pending.set(requestId, answered);
      const waited =
        send?.({ requestId, board }) === true
          ? Effect.map(Effect.timeoutOption(Deferred.await(answered), RENDER_DEADLINE), (result) =>
              Option.getOrElse(
                result,
                (): BoardLookResult => ({ failure: RENDER_FAILURE.NO_ANSWER }),
              ),
            )
          : Effect.succeed<BoardLookResult>({ failure: RENDER_FAILURE.NO_PANEL });
      return Effect.ensuring(
        waited,
        Effect.sync(() => pending.delete(requestId)),
      );
    });

  return {
    link: (next) => {
      send = next;
    },
    render,
    settle: (requestId, result) => {
      const waiting = pending.get(requestId);
      if (waiting === undefined) return false;
      pending.delete(requestId);
      return Deferred.doneUnsafe(waiting, Effect.succeed(result));
    },
  };
}
