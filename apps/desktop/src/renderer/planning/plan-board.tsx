import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { LOOK_AT_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import type { Board } from "@sidecar/hosted/board-wire";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useRef } from "react";
import { ACT_KIND, type ActPayload } from "#shared/messages/acts";
import { actRequest } from "../act";
import { rendererRuntime } from "../renderer-runtime";
import { useAppState } from "../use-app-state";
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
 * A save that is the first to hold a new drawing of Luke's carries the scene
 * drawn as a PNG beside it, which is what the planning model looks at
 * (`look_at_board`). Note that "first" is read off the board main last
 * handed over: until a save holding the drawing lands, main's board still
 * names the drawing before it, so a save that interrupts the first one still
 * carries the image. While the planning model's pending call is a look, the
 * canvas saves the scene it holds with its image as well, so a look at a
 * board Luke did not just draw on still finds one.
 *
 * The board's root is left out of the screen recording (`ph-no-capture`),
 * since the canvas draws its words as pixels the recording's masking cannot
 * reach. The image is drawn off the document, so the recording never sees it.
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

/** One save the canvas asked for: the plan, its scene, the number of Luke's drawing the scene holds, and whether to send the scene's image. */
interface BoardSave {
  readonly planId: string;
  readonly elements: readonly object[];
  readonly appliedDrawing: number;
  readonly module: WhiteboardModule;
  readonly withImage: boolean;
}

/**
 * The scene saved once the developer pauses. Note that a new scene sets this
 * again, which interrupts the save still pausing, so only the scene the
 * canvas stopped on is sent.
 */
const boardSaveAtom = rendererRuntime.fn((save: BoardSave) =>
  Effect.gen(function* () {
    yield* Effect.sleep(SAVE_PAUSE);
    const scene: ActPayload<typeof ACT_KIND.PLANNING_BOARD_SAVE> = {
      planId: save.planId,
      elements: admittedElements(save.elements),
      appliedDrawing: save.appliedDrawing,
    };
    const image = save.withImage
      ? yield* Effect.promise(() => save.module.render(save.elements))
      : undefined;
    const payload = image === undefined ? scene : { ...scene, image };
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
  const firstBoard = useRef(board);
  const latestBoard = useRef(board);
  latestBoard.current = board;
  const save = useAtomSet(boardSaveAtom);
  const looking = useAppState()?.planning.activity?.planner?.action === LOOK_AT_BOARD_TOOL_NAME;

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const mounted = module.mount(element, {
      board: firstBoard.current,
      onScene: (elements, appliedDrawing) =>
        save({
          planId,
          elements,
          appliedDrawing,
          module,
          withImage: appliedDrawing > latestBoard.current.appliedDrawing,
        }),
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

  useEffect(() => {
    const scene = looking ? handle.current?.scene() : undefined;
    if (scene !== undefined) save({ planId, ...scene, module, withImage: true });
  }, [looking, module, planId, save]);

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
