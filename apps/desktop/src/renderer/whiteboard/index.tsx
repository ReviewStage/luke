import "./asset-path";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import type { Board, DrawingElement } from "@sidecar/hosted/board-wire";
import { createRoot } from "react-dom/client";
import {
  sceneSignature,
  type WhiteboardHandle,
  type WhiteboardModule,
  type WhiteboardProps,
} from "./contract";

/**
 * index.tsx -- the whiteboard bundle: Excalidraw mounted into the Plans tab, Luke's drawings put on it, and the panel told when the scene changed.
 *
 * This is its own bundle, loaded once the first time a board is shown, so
 * the bundle every window parses never carries Excalidraw (`contract.ts`). It
 * stands its own React root inside the element the panel hands it.
 *
 * Luke's drawing arrives in the service's small vocabulary and is converted
 * here with Excalidraw's own converter, which measures text and binds arrows
 * and labels on this Mac's canvas. Every element it makes is marked as Luke's
 * (`customData`), so his next drawing takes the place of exactly those, labels
 * included, and leaves whatever the developer drew. An element of his the
 * developer moved is still his, and his next drawing puts it back where he
 * says.
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

/** The mark on every element made from a drawing of Luke's. */
const LUKE_MARK = { drawnBy: "luke" } as const;

function isLukes(element: ExcalidrawElement): boolean {
  return element.customData?.drawnBy === LUKE_MARK.drawnBy;
}

/** Excalidraw's own defaults for what a drawing leaves out, spelled here because a skeleton may not carry an absent field. */
const DRAWING_DEFAULT = {
  WIDTH: 200,
  HEIGHT: 80,
  FONT_SIZE: 20,
  STROKE: "#1e1e1e",
  BACKGROUND: "transparent",
  /** How far an arrow's end stands off the shape it joins. */
  ARROW_GAP: 8,
} as const;

/** A label as Excalidraw's converter takes one, or nothing. */
function labelOf(label: string | undefined) {
  return label === undefined ? undefined : { label: { text: label } };
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A shape's box as the drawing places it. */
function boxOf(element: DrawingElement): Box | undefined {
  if (element.type === BOARD_ELEMENT_TYPE.ARROW) return undefined;
  if (element.type === BOARD_ELEMENT_TYPE.TEXT)
    return { x: element.x, y: element.y, width: 0, height: 0 };
  return {
    x: element.x,
    y: element.y,
    width: element.width ?? DRAWING_DEFAULT.WIDTH,
    height: element.height ?? DRAWING_DEFAULT.HEIGHT,
  };
}

/** Where the ray from a box's center toward a point leaves the box, stood off by the arrow's gap. */
function edgeToward(box: Box, toward: { x: number; y: number }) {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const halfWidth = box.width / 2 + DRAWING_DEFAULT.ARROW_GAP;
  const halfHeight = box.height / 2 + DRAWING_DEFAULT.ARROW_GAP;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
    1,
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * An arrow's run between the facing edges of the two boxes it joins. Note
 * that the converter binds an arrow's ends to their shapes but draws it where
 * its own position and size say, so the run is laid out here.
 */
function arrowRun(from: Box | undefined, to: Box | undefined) {
  if (from === undefined || to === undefined) return { x: 0, y: 0, width: 0, height: 0 };
  const start = edgeToward(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  const end = edgeToward(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
  return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
}

/** One element of Luke's drawing as Excalidraw's converter takes it. */
function skeletonOf(
  element: DrawingElement,
  boxes: ReadonlyMap<string, Box | undefined>,
): ExcalidrawElementSkeleton {
  const common = {
    id: element.id,
    customData: LUKE_MARK,
    strokeColor: element.strokeColor ?? DRAWING_DEFAULT.STROKE,
  };
  switch (element.type) {
    case BOARD_ELEMENT_TYPE.TEXT:
      return {
        ...common,
        type: "text",
        x: element.x,
        y: element.y,
        text: element.text,
        fontSize: element.fontSize ?? DRAWING_DEFAULT.FONT_SIZE,
      };
    case BOARD_ELEMENT_TYPE.ARROW:
      return {
        ...common,
        type: "arrow",
        ...arrowRun(boxes.get(element.from), boxes.get(element.to)),
        start: { id: element.from },
        end: { id: element.to },
        ...labelOf(element.label),
      };
    default:
      return {
        ...common,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width ?? DRAWING_DEFAULT.WIDTH,
        height: element.height ?? DRAWING_DEFAULT.HEIGHT,
        backgroundColor: element.backgroundColor ?? DRAWING_DEFAULT.BACKGROUND,
        ...labelOf(element.label),
      };
  }
}

/** The scene with Luke's previous drawing, labels included, taken out and this one put in. */
function withDrawing(
  scene: readonly ExcalidrawElement[],
  drawing: readonly DrawingElement[],
): ExcalidrawElement[] {
  const boxes = new Map(drawing.map((element) => [element.id, boxOf(element)]));
  const skeletons = drawing.map((element) => skeletonOf(element, boxes));
  const drawn = convertToExcalidrawElements(skeletons, { regenerateIds: false });
  const drawnIds = new Set(drawn.map((element) => element.id));
  const lukes = new Set(scene.filter(isLukes).map((element) => element.id));
  const kept = scene.filter(
    (element) =>
      !isLukes(element) &&
      !drawnIds.has(element.id) &&
      !(
        element.type === BOARD_ELEMENT_TYPE.TEXT &&
        element.containerId &&
        lukes.has(element.containerId)
      ),
  );
  return [...kept, ...drawn.map((element) => ({ ...element, customData: LUKE_MARK }))];
}

/**
 * The board's scene as Excalidraw restores it. Note that its text is not
 * measured again here, because the canvas would measure it before its
 * hand-drawn font had loaded and clip it.
 */
function restoredScene(board: Board): ExcalidrawElement[] {
  // SAFETY: the scene's elements are Excalidraw's own records, read back under the board's
  // schema, and `restoreElements` fills in and repairs whatever a record lacks.
  const scene = board.elements as readonly ExcalidrawElement[];
  return restoreElements(scene, null, { refreshDimensions: false, repairBindings: true });
}

/** Whether the board holds a drawing of Luke's newer than the one numbered `applied`. */
function newerDrawing(board: Board, applied: number) {
  return board.drawing !== undefined && board.drawing.number > applied ? board.drawing : undefined;
}

/** The hand-drawn font Excalidraw measures and draws text in, as the document loads it. */
const DRAWING_FONT = `${DRAWING_DEFAULT.FONT_SIZE}px Excalifont`;

/**
 * One mounted board. Note that it opens on the board's scene through
 * Excalidraw's `initialData`, because the canvas loads that data after it
 * hands out its API and would wipe an update made before. Every change the
 * canvas reports while it is still loading is its own, not the developer's;
 * the first it reports once loaded is the scene it opened on. A newer
 * drawing of Luke's goes in only after that, and after the hand-drawn font
 * has loaded, because the converter measures every label as it makes it and
 * would clip one measured in the fallback font.
 */
function mountBoard(host: HTMLElement, props: WhiteboardProps): WhiteboardHandle {
  const root = createRoot(host);
  let api: ExcalidrawImperativeAPI | undefined;
  let loaded = false;
  let held = "";
  let applied = props.board.appliedDrawing;
  let latest = props.board;

  function show(board: Board): void {
    latest = board;
    const drawing = newerDrawing(board, applied);
    if (api === undefined || !loaded || drawing === undefined) return;
    applied = drawing.number;
    const elements = withDrawing(api.getSceneElementsIncludingDeleted(), drawing.elements);
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    api.scrollToContent(undefined, { fitToContent: true, animate: false });
  }

  function changed(elements: readonly OrderedExcalidrawElement[], appState: AppState): void {
    if (appState.isLoading) return;
    const signature = sceneSignature(elements);
    if (!loaded) {
      loaded = true;
      held = signature;
      api?.scrollToContent(undefined, { fitToContent: true, animate: false });
      document.fonts.load(DRAWING_FONT).then(
        () => show(latest),
        () => show(latest),
      );
      return;
    }
    if (signature === held) return;
    held = signature;
    props.onScene(elements, applied);
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
        elements: restoredScene(props.board),
        appState: { viewBackgroundColor: "transparent" },
      }}
    />,
  );
  return { show, unmount: () => root.unmount() };
}

const whiteboard: WhiteboardModule = { mount: mountBoard };
window.lukeWhiteboard = whiteboard;
