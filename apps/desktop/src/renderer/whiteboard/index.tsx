import "./asset-path";
import {
  CaptureUpdateAction,
  Excalidraw,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Board } from "@sidecar/hosted/board-wire";
import { createRoot } from "react-dom/client";
import {
  sceneSignature,
  type WhiteboardHandle,
  type WhiteboardModule,
  type WhiteboardProps,
} from "./contract";

/**
 * index.tsx -- the whiteboard bundle: Excalidraw mounted into the Plans tab, merged with each board the service holds, and telling the panel when the developer changed it.
 *
 * This is its own bundle, loaded once the first time a board is shown, so
 * the bundle every window parses never carries Excalidraw (`contract.ts`). It
 * stands its own React root inside the element the panel hands it.
 *
 * A board from the service is merged into the canvas by element version
 * (`reconcileElements`), so what the developer is drawing outlives a draw of
 * Luke's, and an element either side erased stays erased. The canvas tells
 * the panel only when its scene differs from the last board the service
 * held, so showing a board sends nothing back, while a merge that kept the
 * developer's newer edits does.
 *
 * What the board leaves out is everything that could carry a file or a page:
 * the image tool, a pasted file, an embedded page, and every save, export,
 * or load to disk. The canvas is dark, as the panel is.
 */

/** Excalidraw's buttons the board does not offer, since a board lives on the service and holds no file. */
const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: true,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: false,
    saveAsImage: false,
  },
  tools: { image: false },
} as const;

/**
 * The service's elements as Excalidraw restores them against what the canvas
 * holds. Note that their text is not measured again here, because the canvas
 * would measure it before its hand-drawn font had loaded and clip it; the
 * service's own estimate runs wide on purpose (`board-skeleton.ts`).
 */
function restored(board: Board, local: readonly OrderedExcalidrawElement[] | null) {
  // SAFETY: the service's elements are Excalidraw's own records, read back under the board's
  // schema, and `restoreElements` fills in and repairs whatever a record lacks.
  const incoming = board.elements as readonly ExcalidrawElement[];
  return restoreElements(incoming, local, { refreshDimensions: false, repairBindings: true });
}

/**
 * One mounted board. Note that it opens on its first board through
 * Excalidraw's `initialData` rather than a merge, because the canvas loads
 * that data after it hands out its API and would wipe a merge made before.
 * Every change the canvas reports while it is still loading is its own, not
 * the developer's, so the first it reports once loaded only sets the scene
 * the service is taken to hold, and fits the whole board into the panel.
 */
function mountBoard(host: HTMLElement, props: WhiteboardProps): WhiteboardHandle {
  const root = createRoot(host);
  let api: ExcalidrawImperativeAPI | undefined;
  let loaded = false;
  let held = "";

  function merge(board: Board): void {
    if (api === undefined || !loaded) return;
    const local = api.getSceneElementsIncludingDeleted();
    // SAFETY: a restored record is the remote side `reconcileElements` takes; the brand is a type alone.
    const remote = restored(board, local) as RemoteExcalidrawElement[];
    held = sceneSignature(remote);
    const elements = reconcileElements(local, remote, api.getAppState());
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  }

  function changed(elements: readonly OrderedExcalidrawElement[], appState: AppState): void {
    if (appState.isLoading) return;
    const signature = sceneSignature(elements);
    if (!loaded) {
      loaded = true;
      held = signature;
      api?.scrollToContent(undefined, { fitToContent: true, animate: false });
      return;
    }
    if (signature === held) return;
    held = signature;
    props.onScene(elements);
  }

  root.render(
    <Excalidraw
      excalidrawAPI={(ready) => {
        api = ready;
      }}
      onChange={changed}
      onPaste={(data) => data.files === undefined || Object.keys(data.files).length === 0}
      validateEmbeddable={false}
      aiEnabled={false}
      theme="dark"
      UIOptions={UI_OPTIONS}
      initialData={{
        elements: restored(props.board, null),
        appState: { viewBackgroundColor: "transparent" },
      }}
    />,
  );
  return { show: merge, unmount: () => root.unmount() };
}

const whiteboard: WhiteboardModule = { mount: mountBoard };
window.lukeWhiteboard = whiteboard;
