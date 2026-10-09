import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Board } from "@sidecar/hosted/board-wire";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useRef } from "react";
import { ACT_KIND, type ActPayload } from "#shared/messages/acts";
import type { BoardRenderRequest } from "#shared/messages/board-render";
import { actRequest } from "../act";
import { rendererRuntime } from "../renderer-runtime";
import {
  WHITEBOARD_ASSET,
  type WhiteboardHandle,
  type WhiteboardModule,
} from "../whiteboard/contract";
import { admittedElements } from "./board-scene";

/**
 * plan-board.tsx -- the open plan's whiteboard in the Plans tab: Excalidraw's bundle loaded once, mounted over the board main holds, and its scene saved.
 *
 * The board is drawn by the whiteboard bundle (`../whiteboard/`), which this
 * page loads the first time a board is shown and keeps for the window's
 * life. The canvas opens on the board main holds and is handed each later
 * one, from which it takes only a newer drawing of Luke's. Each change of its
 * scene, the developer's or a drawing put in, is saved once the canvas
 * pauses, whole, the last write winning.
 *
 * The board's root is left out of the screen recording (`ph-no-capture`),
 * since the canvas draws its words as pixels the recording's masking cannot
 * reach.
 *
 * The same bundle draws a board for the planning model's look whenever main
 * asks (`useBoardRenders`), whether or not the board is on screen, and hands
 * the image back under the request's id. That drawing is never put in the
 * document, so the recording sees none of it.
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

/** One save the canvas asked for: the plan, its scene, and the number of Luke's drawing the scene holds. */
interface BoardSave {
  readonly planId: string;
  readonly elements: readonly object[];
  readonly appliedDrawing: number;
}

/**
 * The scene saved once the developer pauses. Note that a new scene sets this
 * again, which interrupts the save still pausing, so only the scene the
 * canvas stopped on is sent.
 */
const boardSaveAtom = rendererRuntime.fn((save: BoardSave) =>
  Effect.gen(function* () {
    yield* Effect.sleep(SAVE_PAUSE);
    const payload: ActPayload<typeof ACT_KIND.PLANNING_BOARD_SAVE> = {
      planId: save.planId,
      elements: admittedElements(save.elements),
      appliedDrawing: save.appliedDrawing,
    };
    yield* Effect.tryPromise({
      try: () => window.sidecar.act(actRequest(ACT_KIND.PLANNING_BOARD_SAVE, payload)),
      catch: (error) => error,
    });
  }),
);

/**
 * One board main asked the panel to draw: the bundle loaded if it was not,
 * the board drawn, and the image, or why there is none, handed back under the
 * request's id.
 */
const boardRenderAtom = rendererRuntime.fn((request: BoardRenderRequest, get) =>
  Effect.gen(function* () {
    const module = yield* get.result(whiteboardModuleAtom);
    const result = yield* Effect.promise(() => module.render(request.board));
    const payload: ActPayload<typeof ACT_KIND.PLANNING_BOARD_RENDERED> = {
      requestId: request.requestId,
      result,
    };
    yield* Effect.tryPromise({
      try: () => window.sidecar.act(actRequest(ACT_KIND.PLANNING_BOARD_RENDERED, payload)),
      catch: (error) => error,
    });
  }),
);

/** Draws each board main asks for while the panel stands; mounted once, at the panel's root. */
export function useBoardRenders(): void {
  const render = useAtomSet(boardRenderAtom);
  useEffect(() => window.sidecar.onBoardRender(render), [render]);
}

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
  const firstBoard = useRef(board);
  const save = useAtomSet(boardSaveAtom);

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const mounted = module.mount(element, {
      board: firstBoard.current,
      onScene: (elements, appliedDrawing) => save({ planId, elements, appliedDrawing }),
    });
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [module, planId, save]);

  useEffect(() => {
    if (board !== firstBoard.current) handle.current?.show(board);
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
