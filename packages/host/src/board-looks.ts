import { NODE_CAPABILITY_STATUS, type NodeRegistry } from "@sidecar/gateway";
import type { HostedPlanClient } from "@sidecar/hosted";
import {
  BOARD_LOOK_BOUNDS,
  type Board,
  type BoardLookResult,
  boardLookResultSchema,
} from "@sidecar/hosted/board-wire";
import { unparsedWire } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Duration, Effect, Result, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { HOST_NODE_CAPABILITY } from "./node-capabilities.js";

/**
 * board-looks.ts -- the Mac's side of the planning model's `look_at_board`: claim the open plan's next look, draw its board, post the image.
 *
 * The planning model runs on the service and only this Mac's canvas can draw
 * the board as the developer sees it, with Luke's newest drawing put in
 * beside theirs. So while a plan is open, one loop holds a claim open on the
 * service (`apps/web/server/hosted/board-look.ts`), reads the board it is
 * asked about, has the desktop draw it (`renderBoard`, the panel's own
 * Excalidraw), and settles the look with what that answered: the image, or
 * why there is none.
 */

const BOARD_LOOKS = {
  /** How long the loop waits when no plan is open, or the service did not answer. */
  IDLE: Duration.seconds(1),
  RETRY: Duration.seconds(2),
} as const;

/** What a look answers when the service would not hand over the board it is about. */
const NO_BOARD_RESULT: BoardLookResult = { failure: "the board could not be read." };

const readLookResult = readEither(boardLookResultSchema);

/** A reason the desktop gave, cut to what a look's result may carry. */
function failed(reason: string): BoardLookResult {
  return { failure: reason.slice(0, BOARD_LOOK_BOUNDS.MAX_FAILURE_CHARS) };
}

/**
 * A board drawn by the desktop this host runs in, asked through its node
 * (`HOST_NODE_CAPABILITY.RENDER_BOARD`), since only a window can draw. What
 * the desktop answers is read as a look's result like anything crossing in.
 */
export function renderBoardThroughNode(
  nodes: Pick<NodeRegistry, "invoke">,
): BoardLooksDependencies["renderBoard"] {
  return (board) =>
    Effect.map(nodes.invoke(HOST_NODE_CAPABILITY.RENDER_BOARD, { board }), (answered) => {
      if (answered.status !== NODE_CAPABILITY_STATUS.OK) return failed(answered.reason);
      const read = readLookResult(unparsedWire(answered.value ?? null));
      return Result.isSuccess(read) ? read.success : failed("the desktop drew no image.");
    });
}

/** What the loop needs: the service's look calls, the plan open now, and the desktop's drawing of a board. */
export interface BoardLooksDependencies {
  readonly client: Pick<HostedPlanClient, "claimBoardLook" | "settleBoardLook" | "readBoard">;
  /** The open plan, when looks may be claimed for it now. */
  readonly openPlan: () => string | undefined;
  /** The board drawn as the developer sees it; every outcome is a result, never a failure. */
  readonly renderBoard: (board: Board) => Effect.Effect<BoardLookResult>;
}

/** One turn of the loop: claim for the open plan, draw the board, settle the look. */
function serveOnce(dependencies: BoardLooksDependencies): Effect.Effect<void> {
  return Effect.gen(function* () {
    const planId = dependencies.openPlan();
    if (planId === undefined) return yield* Effect.sleep(BOARD_LOOKS.IDLE);
    const claimed = yield* dependencies.client.claimBoardLook(planId);
    if (claimed === undefined) return yield* Effect.sleep(BOARD_LOOKS.RETRY);
    if (claimed === null) return;
    const board = yield* dependencies.client.readBoard(planId);
    const result = board === undefined ? NO_BOARD_RESULT : yield* dependencies.renderBoard(board);
    yield* dependencies.client.settleBoardLook(planId, claimed.id, result);
  }).pipe(Effect.provide(FetchHttpClient.layer));
}

/** The loop, forked into the scope it runs for, so closing the scope stops it. */
export function serveBoardLooks(
  dependencies: BoardLooksDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(Effect.forkScoped(Effect.forever(serveOnce(dependencies))));
}
