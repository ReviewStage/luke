import "./asset-path";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  restoreElements,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawElementSkeleton,
  ValidContainer,
  ValidLinearElement,
} from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { BOARD_ELEMENT_TYPE, DRAWING_STEP_TYPE, LUKE_MARK } from "@sidecar/hosted/board-vocabulary";
import type { Board, Drawing, DrawingElement, DrawingStep } from "@sidecar/hosted/board-wire";
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
 * Luke's drawings arrive in the service's small vocabulary, after
 * Excalidraw's own format for agents, and are applied here in order with
 * Excalidraw's own converter, which measures text and sizes a shape to its
 * label on this Mac's canvas. A drawing that is not a restore first takes
 * Luke's elements off; its `delete` steps take off the elements of his they
 * name, with their labels; and every element it draws is marked as Luke's
 * (`customData`), so the service and his next drawing can tell his elements
 * from the developer's. An element of his the developer moved or edited
 * stays as the developer left it under a restore. Arrows are laid out and
 * bound here rather than by the converter, because an arrow may join an
 * element already on the board, which the converter cannot see. The view
 * then moves to the drawing's `cameraUpdate`, or else to what it added.
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

function isLukes(element: ExcalidrawElement): boolean {
  return element.customData?.drawnBy === LUKE_MARK.drawnBy;
}

/** Excalidraw's own defaults for what a drawing leaves out, spelled here because a skeleton may not carry an absent field. */
const DRAWING_DEFAULT = {
  FONT_SIZE: 20,
  STROKE: "#1e1e1e",
  BACKGROUND: "transparent",
  /** How far an arrow's end stands off the shape it joins. */
  ARROW_GAP: 8,
} as const;

/** The least size of a shape Luke left unsized, as Excalidraw's agent guidance draws one, and the room it adds beside a label the converter fitted tight. */
const SHAPE_SIZE = { MIN_WIDTH: 120, MIN_HEIGHT: 60, LABEL_ROOM: 32 } as const;

/** Excalidraw's corners that round in proportion to the shape (`ROUNDNESS.ADAPTIVE_RADIUS`), as its agent format draws rectangles. */
const ROUNDED_CORNERS = { type: 3 } as const;

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

/** An arrow's run between the facing edges of the two boxes it joins. */
function arrowRun(from: Box, to: Box) {
  const start = edgeToward(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  const end = edgeToward(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
  return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
}

type DrawnArrow = Extract<DrawingElement, { type: typeof BOARD_ELEMENT_TYPE.ARROW }>;
/** A shape's skeleton, built a field at a time since a skeleton may not carry an absent field. */
type ShapeSkeleton = { -readonly [K in keyof ValidContainer]: ValidContainer[K] };
/** An arrow's skeleton, built the same way. */
type ArrowSkeleton = { -readonly [K in keyof ValidLinearElement]: ValidLinearElement[K] };
type DrawnElement = Exclude<DrawingElement, DrawnArrow>;

function isDrawnElement(step: DrawingStep): step is DrawingElement {
  return step.type !== DRAWING_STEP_TYPE.CAMERA && step.type !== DRAWING_STEP_TYPE.DELETE;
}

/**
 * A shape or text of Luke's drawing as Excalidraw's converter takes it. A
 * shape he left unsized takes the size the converter `fitted` to its label,
 * with room beside the label and grown to the least size, or fits its label
 * where nothing was fitted yet.
 */
function skeletonOf(element: DrawnElement, fitted: Box | undefined): ExcalidrawElementSkeleton {
  const common = {
    id: element.id,
    customData: LUKE_MARK,
    strokeColor: element.strokeColor ?? DRAWING_DEFAULT.STROKE,
    x: element.x,
    y: element.y,
  };
  if (element.type === BOARD_ELEMENT_TYPE.TEXT) {
    return {
      ...common,
      type: "text",
      text: element.text,
      fontSize: element.fontSize ?? DRAWING_DEFAULT.FONT_SIZE,
    };
  }
  const shape: ShapeSkeleton = {
    ...common,
    type: element.type,
    backgroundColor: element.backgroundColor ?? DRAWING_DEFAULT.BACKGROUND,
    ...labelOf(element.label),
  };
  const width =
    element.width ??
    (fitted && Math.max(fitted.width + SHAPE_SIZE.LABEL_ROOM, SHAPE_SIZE.MIN_WIDTH));
  const height = element.height ?? (fitted && Math.max(fitted.height, SHAPE_SIZE.MIN_HEIGHT));
  if (width !== undefined) shape.width = width;
  if (height !== undefined) shape.height = height;
  if (element.strokeStyle !== undefined) shape.strokeStyle = element.strokeStyle;
  if (element.opacity !== undefined) shape.opacity = element.opacity;
  if (element.type === BOARD_ELEMENT_TYPE.RECTANGLE) shape.roundness = ROUNDED_CORNERS;
  return shape;
}

/** An arrow of Luke's drawing as Excalidraw's converter takes it, laid out between the boxes it joins. */
function arrowSkeletonOf(arrow: DrawnArrow, from: Box, to: Box): ExcalidrawElementSkeleton {
  const skeleton: ArrowSkeleton = {
    id: arrow.id,
    customData: LUKE_MARK,
    type: "arrow",
    strokeColor: arrow.strokeColor ?? DRAWING_DEFAULT.STROKE,
    ...arrowRun(from, to),
    ...labelOf(arrow.label),
  };
  if (arrow.strokeStyle !== undefined) skeleton.strokeStyle = arrow.strokeStyle;
  return skeleton;
}

function bindingTo(elementId: string) {
  return { elementId, focus: 0, gap: DRAWING_DEFAULT.ARROW_GAP };
}

/**
 * Luke's shapes and text converted, each unsized shape no smaller than the
 * least size. Note that the converter sizes a shape to its label only when
 * the shape carries no size, so the shapes are converted once to fit their
 * labels and again at the size that leaves them.
 */
function sizedShapes(elements: readonly DrawnElement[]): readonly ExcalidrawElement[] {
  const fitted = new Map<string, Box>(
    convertToExcalidrawElements(
      elements.map((element) => skeletonOf(element, undefined)),
      { regenerateIds: false },
    ).map((element) => [element.id, element] as const),
  );
  return convertToExcalidrawElements(
    elements.map((element) => skeletonOf(element, fitted.get(element.id))),
    { regenerateIds: false },
  );
}

/** The scene without the elements under these ids, nor the labels they contain. */
function without(
  scene: readonly ExcalidrawElement[],
  ids: ReadonlySet<string>,
): ExcalidrawElement[] {
  return scene.filter(
    (element) =>
      !ids.has(element.id) &&
      !(
        element.type === BOARD_ELEMENT_TYPE.TEXT &&
        element.containerId &&
        ids.has(element.containerId)
      ),
  );
}

/** What one drawing does to the scene: the scene it leaves, what it put on, and where it asks the view to go. */
interface AppliedDrawing {
  readonly elements: readonly ExcalidrawElement[];
  readonly added: readonly ExcalidrawElement[];
  readonly camera: Box | undefined;
}

/**
 * One drawing of Luke's applied to the scene. Note that an element a later
 * `delete` of the same drawing takes off is never drawn, an element a
 * `delete` names that is already gone is skipped, and an arrow whose end is
 * gone is not drawn, since the developer may have erased an element after
 * the service checked the drawing.
 */
function applyDrawing(scene: readonly ExcalidrawElement[], drawing: Drawing): AppliedDrawing {
  const steps = drawing.elements;
  const deletedAfter = (index: number, id: string) =>
    steps
      .slice(index + 1)
      .some((step) => step.type === DRAWING_STEP_TYPE.DELETE && step.ids.includes(id));
  const drawn = steps.flatMap((step, index) =>
    isDrawnElement(step) && !deletedAfter(index, step.id) ? [step] : [],
  );
  const taken = new Set([
    ...(drawing.restore ? [] : scene.filter(isLukes).map((element) => element.id)),
    ...steps.flatMap((step) => (step.type === DRAWING_STEP_TYPE.DELETE ? step.ids : [])),
  ]);
  const kept = without(scene, taken);

  const shapes = sizedShapes(
    drawn.flatMap((element) => (element.type === BOARD_ELEMENT_TYPE.ARROW ? [] : [element])),
  );
  const boxes = new Map<string, Box>(
    [...kept, ...shapes]
      .filter((element) => !element.isDeleted)
      .map((element) => [element.id, element] as const),
  );
  const arrows = drawn.filter((element) => element.type === BOARD_ELEMENT_TYPE.ARROW);
  const joined = arrows.flatMap((arrow) => {
    const from = boxes.get(arrow.from);
    const to = boxes.get(arrow.to);
    return from === undefined || to === undefined
      ? []
      : [{ arrow, skeleton: arrowSkeletonOf(arrow, from, to) }];
  });
  const arrowElements = convertToExcalidrawElements(
    joined.map(({ skeleton }) => skeleton),
    { regenerateIds: false },
  ).map((element) => {
    const join = joined.find(({ arrow }) => arrow.id === element.id);
    return join === undefined || element.type !== "arrow"
      ? element
      : {
          ...element,
          startBinding: bindingTo(join.arrow.from),
          endBinding: bindingTo(join.arrow.to),
        };
  });

  const boundArrows = new Map<string, string[]>();
  for (const { arrow } of joined) {
    for (const end of new Set([arrow.from, arrow.to])) {
      boundArrows.set(end, [...(boundArrows.get(end) ?? []), arrow.id]);
    }
  }
  const withArrows = (element: ExcalidrawElement): ExcalidrawElement => {
    const bound = boundArrows.get(element.id);
    if (bound === undefined) return element;
    return {
      ...element,
      version: element.version + 1,
      boundElements: [
        ...(element.boundElements ?? []),
        ...bound.map((id) => ({ id, type: "arrow" as const })),
      ],
    };
  };

  const made = [...shapes, ...arrowElements];
  const added = drawn.flatMap((element) =>
    made
      .filter(
        (part) =>
          part.id === element.id || (part.type === "text" && part.containerId === element.id),
      )
      .map((part) => withArrows({ ...part, customData: LUKE_MARK })),
  );
  const camera = steps.findLast((step) => step.type === DRAWING_STEP_TYPE.CAMERA);
  return { elements: [...kept.map(withArrows), ...added], added, camera };
}

/** Every drawing applied in order: the scene they leave, what they put on that is still there, and the last view asked for. */
function applyDrawings(
  scene: readonly ExcalidrawElement[],
  drawings: readonly Drawing[],
): AppliedDrawing {
  return drawings.reduce<AppliedDrawing>(
    (before, drawing) => {
      const after = applyDrawing(before.elements, drawing);
      const standing = new Set(after.elements.map((element) => element.id));
      return {
        elements: after.elements,
        added: [...before.added.filter((element) => standing.has(element.id)), ...after.added],
        camera: after.camera ?? before.camera,
      };
    },
    { elements: scene, added: [], camera: undefined },
  );
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

/** The hand-drawn font Excalidraw measures and draws text in, as the document loads it. */
const DRAWING_FONT = `${DRAWING_DEFAULT.FONT_SIZE}px Excalifont`;

/**
 * One mounted board. Note that it opens on the board's scene through
 * Excalidraw's `initialData`, because the canvas loads that data after it
 * hands out its API and would wipe an update made before. Every change the
 * canvas reports while it is still loading is its own, not the developer's;
 * the first it reports once loaded is the scene it opened on. Luke's newer
 * drawings go in only after that, and after the hand-drawn font has loaded,
 * because the converter measures every label as it makes it and would clip
 * one measured in the fallback font.
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
    const drawings = board.drawings.filter((drawing) => drawing.number > applied);
    const newest = drawings.at(-1);
    if (api === undefined || !loaded || newest === undefined) return;
    applied = newest.number;
    const { elements, added, camera } = applyDrawings(
      api.getSceneElementsIncludingDeleted(),
      drawings,
    );
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    if (camera !== undefined) {
      const { x, y, width, height } = camera;
      const area = convertToExcalidrawElements([{ type: "rectangle", x, y, width, height }]);
      api.scrollToContent(area, { fitToViewport: true, animate: true });
    } else if (added.length > 0) {
      api.scrollToContent(added, { fitToContent: true, animate: true });
    }
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
