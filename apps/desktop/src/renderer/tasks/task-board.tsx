import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { admittedElements } from "@luke/features/board-scene";
import { LOOK_AT_BOARD_TOOL_NAME } from "@luke/features/board-vocabulary";
import type { Board } from "@luke/features/board-wire";
import { ACT_KIND, type ActPayload } from "@luke/host/acts";
import { askAct } from "@luke/panel/act";
import { ERROR_STATE_PLACEMENT, ErrorState } from "@luke/ui";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Fragment, useEffect, useRef } from "react";
import { BOARD_LOAD_FAILED, useSideBundles } from "../bundle-loader";
import { rendererRuntime } from "../renderer-runtime";
import { SpinnerRegion } from "../spinner";
import { useAppState } from "../use-app-state";
import type { WhiteboardHandle, WhiteboardModule } from "../whiteboard/contract";

/**
 * task-board.tsx -- the open task's whiteboard in the Tasks tab: Excalidraw's bundle loaded once, mounted over the board main holds, and its scene saved.
 *
 * The board is drawn by the whiteboard bundle (`../whiteboard/`), which this
 * page loads the first time a board is shown and keeps for the window's
 * life. The canvas opens on the board main holds and is handed each later
 * one, from which it takes only a newer drawing of Luke's. Each change of its
 * scene, the developer's or a drawing put in, is saved once the canvas
 * pauses, whole, the last write winning.
 *
 * A save that is the first to hold a new drawing of Luke's carries the scene
 * drawn as a PNG beside it, which is what the brain looks at
 * (`look_at_board`). Note that "first" is read off the board main last
 * handed over: until a save holding the drawing lands, main's board still
 * names the drawing before it, so a save that interrupts the first one still
 * carries the image. While the brain's pending call is a look, the
 * canvas saves the scene it holds with its image as well, so a look at a
 * board Luke did not just draw on still finds one.
 *
 * An archived task's board is view-only: it shows, and nothing on it is
 * drawn or saved until the task is brought back, which mounts the canvas
 * afresh as an editable one.
 *
 * The board's root is left out of the screen recording (`ph-no-capture`),
 * since the canvas draws its words as pixels the recording's masking cannot
 * reach. The image is drawn off the document, so the recording never sees it.
 */

/** How long the developer's drawing rests before it is saved. */
const SAVE_PAUSE = Duration.millis(800);

/** One save the canvas asked for: the task, its scene, the number of Luke's drawing the scene holds, and whether to send the scene's image. */
interface BoardSave {
  readonly taskId: string;
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
    const scene: ActPayload<typeof ACT_KIND.TASKS_BOARD_SAVE> = {
      taskId: save.taskId,
      elements: admittedElements(save.elements),
      appliedDrawing: save.appliedDrawing,
    };
    const image = save.withImage
      ? yield* Effect.promise(() => save.module.render(save.elements))
      : undefined;
    const payload = image === undefined ? scene : { ...scene, image };
    yield* Effect.tryPromise({
      try: () => askAct(ACT_KIND.TASKS_BOARD_SAVE, payload),
      catch: (error) => error,
    });
  }),
);

/** The canvas, once its bundle has loaded: mounted for one task, and handed each board main holds. */
function BoardCanvas({
  module,
  taskId,
  board,
  viewOnly,
}: {
  module: WhiteboardModule;
  taskId: string;
  board: Board;
  viewOnly: boolean;
}): React.JSX.Element {
  const mountedViewOnly = useRef(viewOnly);
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<WhiteboardHandle | undefined>(undefined);
  const firstBoard = useRef(board);
  const latestBoard = useRef(board);
  latestBoard.current = board;
  const save = useAtomSet(boardSaveAtom);
  const looking = useAppState()?.tasks.activity?.planner?.action === LOOK_AT_BOARD_TOOL_NAME;

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const mounted = module.mount(element, {
      board: firstBoard.current,
      viewOnly: mountedViewOnly.current,
      onScene: (elements, appliedDrawing) =>
        save({
          taskId,
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
  }, [module, taskId, save]);

  useEffect(() => {
    if (board !== firstBoard.current) handle.current?.show(board);
  }, [board]);

  useEffect(() => {
    // A view-only board saves nothing, a look's image included.
    const scene = looking && !viewOnly ? handle.current?.scene() : undefined;
    if (scene !== undefined) save({ taskId, ...scene, module, withImage: true });
  }, [looking, viewOnly, module, taskId, save]);

  return <div ref={host} className="task-board-canvas" />;
}

/**
 * The board page: the canvas over the open task's board, or the state that
 * stands in its place while the board or its bundle is still on the way.
 */
export function TaskBoard({
  taskId,
  board,
  viewOnly = false,
}: {
  taskId: string;
  board: Board | undefined;
  /** Whether the board only shows, as an archived task's does. */
  viewOnly?: boolean;
}): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().whiteboard);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  return (
    <section className="task-board ph-no-capture" aria-label="Whiteboard">
      {AsyncResult.isFailure(loaded) ? (
        <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED}>{BOARD_LOAD_FAILED}</ErrorState>
      ) : null}
      {module !== undefined && board !== undefined ? (
        // Keyed by whether it only shows as well, so an Unarchive mounts an editable canvas.
        <Fragment key={String(viewOnly)}>
          <BoardCanvas
            key={taskId}
            module={module}
            taskId={taskId}
            board={board}
            viewOnly={viewOnly}
          />
        </Fragment>
      ) : null}
      {!AsyncResult.isFailure(loaded) && (module === undefined || board === undefined) ? (
        <SpinnerRegion label="Loading board" />
      ) : null}
    </section>
  );
}
