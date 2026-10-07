import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Board } from "@sidecar/hosted/board-wire";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useRef } from "react";
import { ACT_KIND, type ActPayload } from "#shared/messages/acts";
import { actRequest } from "../act";
import { rendererRuntime } from "../renderer-runtime";
import {
  WHITEBOARD_ASSET,
  type WhiteboardHandle,
  type WhiteboardModule,
} from "../whiteboard/contract";
import { admittedElements } from "./board-scene";

/**
 * plan-board.tsx -- the open plan's whiteboard in the Plans tab: Excalidraw's bundle loaded once, mounted over the board main holds, and the developer's changes saved.
 *
 * The board is drawn by the whiteboard bundle (`../whiteboard/`), which this
 * page loads the first time a board is shown and keeps for the window's
 * life. Each board main holds is handed to the canvas, which merges it in;
 * each change the developer makes is saved once they pause, over the
 * revision of the last board the canvas merged, so a save made over a draw
 * of Luke's that has not reached this panel yet is refused by the service
 * and merged here instead of written over it.
 *
 * The board's root is left out of the screen recording (`ph-no-capture`),
 * since the canvas draws its words as pixels the recording's masking cannot
 * reach.
 */

/** How long the developer's drawing rests before it is saved. */
const SAVE_PAUSE = Duration.millis(800);

/** Where the board stands while its bundle loads or fails to. */
const BOARD_LOAD_FAILED = "The board could not be opened.";

/**
 * The whiteboard bundle, loaded once per window: its stylesheet and its
 * script added to the document, answered with what the script set on
 * `window`. Kept alive, so leaving the board and coming back loads nothing.
 */
const whiteboardModuleAtom = Atom.keepAlive(
  rendererRuntime.atom(
    Effect.callback<WhiteboardModule, Error>((resume) => {
      const loaded = window.lukeWhiteboard;
      if (loaded !== undefined) {
        resume(Effect.succeed(loaded));
        return;
      }
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = WHITEBOARD_ASSET.STYLESHEET;
      const script = document.createElement("script");
      script.src = WHITEBOARD_ASSET.SCRIPT;
      script.addEventListener("load", () => {
        const module = window.lukeWhiteboard;
        resume(module ? Effect.succeed(module) : Effect.fail(new Error(BOARD_LOAD_FAILED)));
      });
      script.addEventListener("error", () => resume(Effect.fail(new Error(BOARD_LOAD_FAILED))));
      document.head.append(stylesheet, script);
    }),
  ),
);

/** One save the canvas asked for: the plan, its scene, and where to read the revision it was drawn over once the pause ends. */
interface BoardSave {
  readonly planId: string;
  readonly elements: readonly object[];
  readonly baseRevision: () => number;
}

/**
 * The developer's scene saved once they pause. Note that a new scene sets
 * this again, which interrupts the save still pausing, so only the scene the
 * developer stopped on is sent; the revision is read as it is sent, so it is
 * the last board the canvas merged.
 */
const boardSaveAtom = rendererRuntime.fn((save: BoardSave) =>
  Effect.gen(function* () {
    yield* Effect.sleep(SAVE_PAUSE);
    const payload: ActPayload<typeof ACT_KIND.PLANNING_BOARD_SAVE> = {
      planId: save.planId,
      baseRevision: save.baseRevision(),
      elements: admittedElements(save.elements),
    };
    yield* Effect.tryPromise({
      try: () => window.sidecar.act(actRequest(ACT_KIND.PLANNING_BOARD_SAVE, payload)),
      catch: (error) => error,
    });
  }),
);

/** The canvas, once its bundle has loaded: mounted for one plan, and handed each board main holds. */
function BoardCanvas({
  module,
  planId,
  board,
}: {
  module: WhiteboardModule;
  planId: string;
  board: Board;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<WhiteboardHandle | undefined>(undefined);
  const merged = useRef(board.revision);
  const firstBoard = useRef(board);
  const save = useAtomSet(boardSaveAtom);

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const mounted = module.mount(element, {
      board: firstBoard.current,
      onScene: (elements) => save({ planId, elements, baseRevision: () => merged.current }),
    });
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module, planId, save]);

  useEffect(() => {
    if (board.revision === merged.current && board === firstBoard.current) return;
    merged.current = board.revision;
    handle.current?.show(board);
  }, [board]);

  return <div ref={host} className="plan-board-canvas" />;
}

/**
 * The board page: the canvas over the open plan's board, or the state that
 * stands in its place while the board or its bundle is still on the way.
 */
export function PlanBoard({
  planId,
  board,
}: {
  planId: string;
  board: Board | undefined;
}): React.JSX.Element {
  const loaded = useAtomValue(whiteboardModuleAtom);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  return (
    <section className="plan-board ph-no-capture" aria-label="Whiteboard">
      {AsyncResult.isFailure(loaded) ? <p role="alert">{BOARD_LOAD_FAILED}</p> : null}
      {module !== undefined && board !== undefined ? (
        <BoardCanvas key={planId} module={module} planId={planId} board={board} />
      ) : null}
      {!AsyncResult.isFailure(loaded) && (module === undefined || board === undefined) ? (
        <p aria-busy="true">Opening the board…</p>
      ) : null}
    </section>
  );
}
