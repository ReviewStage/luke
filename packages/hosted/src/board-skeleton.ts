import { isWireString, type WireValue } from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import {
  BOARD_BOUNDS,
  BOARD_ELEMENT_TYPE,
  type BoardElement,
  type BoardElementType,
  boardFitsBytes,
  LINE_END,
  type LineEnd,
  lineEnd,
} from "./board-wire.js";

/**
 * board-skeleton.ts -- Luke's drawing operations and the one function that turns them into Excalidraw elements on a board.
 *
 * Luke draws by naming what he wants, never by writing Excalidraw's own
 * element records: a box with a label at a place, an arrow from one box to
 * another, a line of text. `applyBoardOps` turns each operation into the
 * elements Excalidraw stores, applied in order over the board's elements as
 * they stand, and answers the whole new list or the first operation it
 * refused. It runs on the service rather than the Mac, because then a draw
 * lands whether or not a Mac has the plan open, and the stored board has one
 * shape whoever wrote it.
 *
 * Text is never measured here, since no font stands on a server: a label's
 * size is estimated from its characters, and the Mac's canvas measures it
 * again when it loads the board (`restoreElements` with
 * `refreshDimensions`). Arrows run between the two shapes' edges along the
 * line joining their centers, and every shape an operation moves or resizes
 * takes its label and the arrows bound to it along.
 *
 * Every element an operation touches has its version raised, so a merge by
 * version keeps Luke's change over the developer's older copy. A removal
 * marks the element deleted rather than dropping it, together with its label
 * and every arrow bound to it, so a merge cannot bring any of them back.
 * Randomness Excalidraw keeps per element (its stroke seed and version
 * nonce) is derived from the element's id and version, so the function is
 * pure.
 */

/** The ids Luke gives elements: short, lower case, and never spelling a label's id. */
const LUKE_ID = describeWire(
  EffectSchema.String.check(
    EffectSchema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
    EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_ID_CHARS - 8),
  ),
  'A short kebab-case id you choose, such as "api" or "db-to-cache", used to update, remove, or connect it later.',
);

/** Any element on the board, the developer's included, by the id the board shows. */
const BOARD_ID = describeWire(
  EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_ID_CHARS),
  ),
  "The id of an element on the board, as the board lists it.",
);

const COORDINATE = EffectSchema.Finite.check(
  EffectSchema.isGreaterThanOrEqualTo(-100_000),
  EffectSchema.isLessThanOrEqualTo(100_000),
);

const SIZE = EffectSchema.Finite.check(
  EffectSchema.isGreaterThanOrEqualTo(10),
  EffectSchema.isLessThanOrEqualTo(4_000),
);

const LABEL = describeWire(
  EffectSchema.String.check(EffectSchema.isMaxLength(500)),
  "Words drawn inside it; an empty string removes them.",
);

const COLOR = describeWire(
  EffectSchema.String.check(EffectSchema.isPattern(/^(#[0-9a-fA-F]{6}|transparent)$/)),
  'A hex color such as "#1971c2", or "transparent".',
);

const POINT = EffectSchema.Struct({ x: COORDINATE, y: COORDINATE });

const ENDPOINT = describeWire(
  EffectSchema.Union([BOARD_ID, POINT]),
  "The id of a shape to attach to, or a point { x, y } to leave free.",
);

/** The shapes Luke draws as closed outlines. */
const BOARD_SHAPE = {
  RECTANGLE: BOARD_ELEMENT_TYPE.RECTANGLE,
  ELLIPSE: BOARD_ELEMENT_TYPE.ELLIPSE,
  DIAMOND: BOARD_ELEMENT_TYPE.DIAMOND,
} as const;

const shapeSkeleton = EffectSchema.Struct({
  type: EffectSchema.Literals(Object.values(BOARD_SHAPE)),
  id: LUKE_ID,
  x: describeWire(COORDINATE, "Left edge, in pixels."),
  y: describeWire(COORDINATE, "Top edge, in pixels."),
  width: EffectSchema.optionalKey(describeWire(SIZE, "Width in pixels; 200 when left out.")),
  height: EffectSchema.optionalKey(describeWire(SIZE, "Height in pixels; 80 when left out.")),
  label: EffectSchema.optionalKey(LABEL),
  strokeColor: EffectSchema.optionalKey(COLOR),
  backgroundColor: EffectSchema.optionalKey(COLOR),
});

const textSkeleton = EffectSchema.Struct({
  type: EffectSchema.Literal(BOARD_ELEMENT_TYPE.TEXT),
  id: LUKE_ID,
  x: describeWire(COORDINATE, "Left edge, in pixels."),
  y: describeWire(COORDINATE, "Top edge, in pixels."),
  text: EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_TEXT_CHARS),
  ),
  fontSize: EffectSchema.optionalKey(
    describeWire(
      EffectSchema.Finite.check(
        EffectSchema.isGreaterThanOrEqualTo(8),
        EffectSchema.isLessThanOrEqualTo(96),
      ),
      "Font size in pixels; 20 when left out.",
    ),
  ),
  strokeColor: EffectSchema.optionalKey(COLOR),
});

const arrowSkeleton = EffectSchema.Struct({
  type: EffectSchema.Literal(BOARD_ELEMENT_TYPE.ARROW),
  id: LUKE_ID,
  from: ENDPOINT,
  to: ENDPOINT,
  label: EffectSchema.optionalKey(LABEL),
  strokeColor: EffectSchema.optionalKey(COLOR),
});

const lineSkeleton = EffectSchema.Struct({
  type: EffectSchema.Literal(BOARD_ELEMENT_TYPE.LINE),
  id: LUKE_ID,
  points: describeWire(
    EffectSchema.Array(POINT).check(EffectSchema.isMinLength(2), EffectSchema.isMaxLength(100)),
    "The line's points in board pixels, in order.",
  ),
  strokeColor: EffectSchema.optionalKey(COLOR),
});

const skeletonSchema = EffectSchema.Union([
  shapeSkeleton,
  textSkeleton,
  arrowSkeleton,
  lineSkeleton,
]);

export type BoardSkeleton = typeof skeletonSchema.Type;

export const BOARD_OP = {
  ADD: "add",
  UPDATE: "update",
  REMOVE: "remove",
  CLEAR: "clear",
} as const;

const addOp = EffectSchema.Struct({
  op: EffectSchema.Literal(BOARD_OP.ADD),
  element: skeletonSchema,
});

const updateOp = EffectSchema.Struct({
  op: EffectSchema.Literal(BOARD_OP.UPDATE),
  id: BOARD_ID,
  x: EffectSchema.optionalKey(COORDINATE),
  y: EffectSchema.optionalKey(COORDINATE),
  width: EffectSchema.optionalKey(SIZE),
  height: EffectSchema.optionalKey(SIZE),
  label: EffectSchema.optionalKey(
    describeWire(
      EffectSchema.String.check(EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_TEXT_CHARS)),
      "A shape's or arrow's new label, or a text element's new words; an empty string removes a label.",
    ),
  ),
  from: EffectSchema.optionalKey(ENDPOINT),
  to: EffectSchema.optionalKey(ENDPOINT),
  strokeColor: EffectSchema.optionalKey(COLOR),
  backgroundColor: EffectSchema.optionalKey(COLOR),
});

const removeOp = EffectSchema.Struct({
  op: EffectSchema.Literal(BOARD_OP.REMOVE),
  id: BOARD_ID,
});

const clearOp = EffectSchema.Struct({ op: EffectSchema.Literal(BOARD_OP.CLEAR) });

const boardOpSchema = EffectSchema.Union([addOp, updateOp, removeOp, clearOp]);

export type BoardOp = typeof boardOpSchema.Type;

/** `draw_on_board`'s input: the operations, applied in order. */
export const boardOpsInputSchema = EffectSchema.Struct({
  operations: describeWire(
    EffectSchema.Array(boardOpSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(100),
    ),
    "The changes to make, applied in order; a later one may name an id an earlier one added.",
  ),
});

/** Why a batch of operations changed nothing, in words the model can act on. */
export const BOARD_OP_REFUSAL = {
  ID_TAKEN: "That id is already on the board; choose another, or update the element.",
  NO_ELEMENT: "No element on the board has that id.",
  NOT_A_SHAPE: "An arrow may attach only to a rectangle, ellipse, diamond, or text.",
  NOT_AN_ARROW: "Only an arrow takes `from` and `to`.",
  NOT_LABELLED: "A line takes no label.",
  TOO_LARGE: "The board would hold more than it may; remove or clear something first.",
} as const;

export interface BoardOpRefusal {
  /** The position in `operations` of the operation refused. */
  readonly at: number;
  readonly reason: string;
}

const DEFAULT = {
  WIDTH: 200,
  HEIGHT: 80,
  FONT_SIZE: 20,
  STROKE: "#1e1e1e",
  BACKGROUND: "transparent",
  /** How far an arrow's end stands off the shape it is bound to. */
  ARROW_GAP: 8,
} as const;

/** Excalidraw's own numbers this file writes into elements it makes. */
const EXCALIDRAW = {
  /** Excalidraw's hand-drawn font, its default from 0.18. */
  FONT_FAMILY: 5,
  LINE_HEIGHT: 1.25,
  /** The average glyph width, as a share of the font size, used to estimate a label's width. */
  GLYPH_WIDTH: 0.55,
  ROUNDNESS_ADAPTIVE: 3,
  ROUNDNESS_PROPORTIONAL: 2,
} as const;

const BINDABLE: ReadonlySet<BoardElementType> = new Set([
  BOARD_ELEMENT_TYPE.RECTANGLE,
  BOARD_ELEMENT_TYPE.ELLIPSE,
  BOARD_ELEMENT_TYPE.DIAMOND,
  BOARD_ELEMENT_TYPE.TEXT,
]);

const LABELLED: ReadonlySet<BoardElementType> = new Set([
  BOARD_ELEMENT_TYPE.RECTANGLE,
  BOARD_ELEMENT_TYPE.ELLIPSE,
  BOARD_ELEMENT_TYPE.DIAMOND,
  BOARD_ELEMENT_TYPE.ARROW,
]);

type Point = typeof POINT.Type;

/** Fields written over a standing element. */
type BoardPatch = { readonly [field: string]: WireValue };
type Endpoint = typeof ENDPOINT.Type;

/** One entry of an element's `boundElements`: its label, or an arrow bound to it. */
type BoundRef = NonNullable<BoardElement["boundElements"]>[number];

/** A small deterministic hash, so Excalidraw's per-element randomness is a function of id and version. */
function hashOf(id: string, version: number): number {
  let hash = 2166136261 ^ version;
  for (let at = 0; at < id.length; at += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(at), 16777619);
  }
  return hash >>> 0;
}

/** The fields every element Excalidraw stores carries, at version 1 or past the tombstone it replaces. */
function baseElement(id: string, type: BoardElementType, version: number, now: number) {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: DEFAULT.STROKE,
    backgroundColor: DEFAULT.BACKGROUND,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: hashOf(id, 0),
    version,
    versionNonce: hashOf(id, version),
    index: null,
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
  };
}

/** A label's size as estimated from its characters; the Mac measures it again. */
function textSize(text: string, fontSize: number) {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  return {
    width: Math.ceil(longest * fontSize * EXCALIDRAW.GLYPH_WIDTH),
    height: Math.ceil(lines.length * fontSize * EXCALIDRAW.LINE_HEIGHT),
  };
}

function textFields(text: string, fontSize: number, containerId: string | null) {
  return {
    text,
    originalText: text,
    fontSize,
    fontFamily: EXCALIDRAW.FONT_FAMILY,
    textAlign: containerId ? "center" : "left",
    verticalAlign: containerId ? "middle" : "top",
    containerId,
    autoResize: true,
    lineHeight: EXCALIDRAW.LINE_HEIGHT,
  };
}

/** A shape's middle, or the middle of a line's run from its first point to its last. */
function centerOf(element: BoardElement): Point {
  if (!element.points || element.points.length === 0) {
    return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  }
  const start = lineEnd(element, LINE_END.START);
  const end = lineEnd(element, LINE_END.END);
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

/** Where the ray from a shape's center toward a point leaves its bounding box, stood off by the gap. */
function edgeToward(shape: BoardElement, toward: Point): Point {
  const center = centerOf(shape);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfWidth = shape.width / 2 + DEFAULT.ARROW_GAP;
  const halfHeight = shape.height / 2 + DEFAULT.ARROW_GAP;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
  );
  return { x: center.x + dx * Math.min(scale, 1), y: center.y + dy * Math.min(scale, 1) };
}

/** The board's elements by id, mutated in place as operations apply; order is kept by `order`. */
class Scene {
  readonly #byId = new Map<string, BoardElement>();
  readonly #order: string[] = [];
  readonly #touched = new Set<string>();

  constructor(
    elements: readonly BoardElement[],
    readonly now: number,
  ) {
    for (const element of elements) {
      this.#byId.set(element.id, element);
      this.#order.push(element.id);
    }
  }

  live(id: string): BoardElement | undefined {
    const element = this.#byId.get(id);
    return element && !element.isDeleted ? element : undefined;
  }

  /** The version a new element under this id starts at: past any tombstone it replaces. */
  nextVersion(id: string): number {
    return (this.#byId.get(id)?.version ?? 0) + 1;
  }

  put(element: BoardElement): void {
    if (!this.#byId.has(element.id)) this.#order.push(element.id);
    this.#byId.set(element.id, element);
  }

  /** Writes a change over a standing element, raising its version once per batch. */
  change(id: string, patch: BoardPatch): BoardElement {
    const element = this.#byId.get(id);
    if (!element) throw new Error(`board-skeleton: change of an absent element ${id}`);
    const version = this.#touched.has(id) ? element.version : element.version + 1;
    this.#touched.add(id);
    const next = {
      ...element,
      ...patch,
      version,
      versionNonce: hashOf(id, version),
      updated: this.now,
    };
    this.#byId.set(id, next);
    return next;
  }

  added(id: string): void {
    this.#touched.add(id);
  }

  liveElements(): BoardElement[] {
    return this.elements().filter((element) => !element.isDeleted);
  }

  elements(): BoardElement[] {
    return this.#order.flatMap((id) => {
      const element = this.#byId.get(id);
      return element ? [element] : [];
    });
  }
}

function boundRefs(element: BoardElement): readonly BoundRef[] {
  return element.boundElements ?? [];
}

function labelOf(scene: Scene, container: BoardElement): BoardElement | undefined {
  const ref = boundRefs(container).find((bound) => bound.type === BOARD_ELEMENT_TYPE.TEXT);
  return ref ? scene.live(ref.id) : undefined;
}

/** Centers a label over its container: the middle of a shape, or of an arrow's run. */
function placeLabel(scene: Scene, container: BoardElement): void {
  const label = labelOf(scene, container);
  if (!label) return;
  const center = centerOf(container);
  scene.change(label.id, { x: center.x - label.width / 2, y: center.y - label.height / 2 });
}

/** Writes, replaces, or removes a container's label. */
function setLabel(scene: Scene, containerId: string, words: string): void {
  const container = scene.live(containerId);
  if (!container) return;
  const standing = labelOf(scene, container);
  if (words.length === 0) {
    if (standing) scene.change(standing.id, { isDeleted: true });
    scene.change(containerId, {
      boundElements: boundRefs(container).filter((bound) => bound.id !== standing?.id),
    });
    return;
  }
  const size = textSize(words, DEFAULT.FONT_SIZE);
  if (standing) {
    scene.change(standing.id, { ...textFields(words, DEFAULT.FONT_SIZE, containerId), ...size });
  } else {
    const id = `${containerId}.label`;
    scene.put({
      ...baseElement(id, BOARD_ELEMENT_TYPE.TEXT, scene.nextVersion(id), scene.now),
      ...textFields(words, DEFAULT.FONT_SIZE, containerId),
      ...size,
    });
    scene.added(id);
    scene.change(containerId, {
      boundElements: [...boundRefs(container), { id, type: BOARD_ELEMENT_TYPE.TEXT }],
    });
  }
  const placed = scene.live(containerId);
  if (placed) placeLabel(scene, placed);
}

/** The point an endpoint names: a free point as given, or a shape's center to be clipped later. */
function endpointShape(
  scene: Scene,
  endpoint: Endpoint,
): Result.Result<BoardElement | Point, string> {
  if (!isWireString(endpoint)) return Result.succeed(endpoint);
  const shape = scene.live(endpoint);
  if (!shape) return Result.fail(BOARD_OP_REFUSAL.NO_ELEMENT);
  if (!BINDABLE.has(shape.type)) return Result.fail(BOARD_OP_REFUSAL.NOT_A_SHAPE);
  return Result.succeed(shape);
}

function isShape(value: BoardElement | Point): value is BoardElement {
  return "id" in value;
}

/** An arrow's geometry and bindings between two ends, each a shape or a free point. */
function arrowRun(from: BoardElement | Point, to: BoardElement | Point) {
  const fromCenter = isShape(from) ? centerOf(from) : from;
  const toCenter = isShape(to) ? centerOf(to) : to;
  const start = isShape(from) ? edgeToward(from, toCenter) : from;
  const end = isShape(to) ? edgeToward(to, fromCenter) : to;
  const binding = (end: BoardElement | Point) =>
    isShape(end) ? { elementId: end.id, focus: 0, gap: DEFAULT.ARROW_GAP } : null;
  return {
    x: start.x,
    y: start.y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    points: [
      [0, 0],
      [end.x - start.x, end.y - start.y],
    ],
    startBinding: binding(from),
    endBinding: binding(to),
  };
}

/** Adds an arrow's id to a shape's bound elements, once. */
function bindTo(scene: Scene, shapeId: string, arrowId: string): void {
  const shape = scene.live(shapeId);
  if (!shape || boundRefs(shape).some((bound) => bound.id === arrowId)) return;
  scene.change(shapeId, {
    boundElements: [...boundRefs(shape), { id: arrowId, type: BOARD_ELEMENT_TYPE.ARROW }],
  });
}

function unbindFrom(scene: Scene, shapeId: string | undefined, arrowId: string): void {
  if (!shapeId) return;
  const shape = scene.live(shapeId);
  if (!shape) return;
  scene.change(shapeId, {
    boundElements: boundRefs(shape).filter((bound) => bound.id !== arrowId),
  });
}

/** Draws an arrow's run between its ends again, and binds the shapes at each end to it. */
function routeArrow(
  scene: Scene,
  arrow: BoardElement,
  from: BoardElement | Point,
  to: BoardElement | Point,
): void {
  unbindFrom(scene, arrow.startBinding?.elementId, arrow.id);
  unbindFrom(scene, arrow.endBinding?.elementId, arrow.id);
  scene.change(arrow.id, arrowRun(from, to));
  if (isShape(from)) bindTo(scene, from.id, arrow.id);
  if (isShape(to)) bindTo(scene, to.id, arrow.id);
  const routed = scene.live(arrow.id);
  if (routed) placeLabel(scene, routed);
}

/** The end of a standing arrow as it stands: its bound shape, or the free point it ends at. */
function standingEnd(scene: Scene, arrow: BoardElement, which: LineEnd): BoardElement | Point {
  const binding = which === LINE_END.START ? arrow.startBinding : arrow.endBinding;
  const bound = binding ? scene.live(binding.elementId) : undefined;
  return bound ?? lineEnd(arrow, which);
}

/** Takes a moved or resized shape's label and every arrow bound to it along. */
function follow(scene: Scene, shapeId: string): void {
  const shape = scene.live(shapeId);
  if (!shape) return;
  placeLabel(scene, shape);
  for (const ref of boundRefs(shape)) {
    const arrow = scene.live(ref.id);
    if (!arrow || arrow.type !== BOARD_ELEMENT_TYPE.ARROW) continue;
    routeArrow(
      scene,
      arrow,
      standingEnd(scene, arrow, LINE_END.START),
      standingEnd(scene, arrow, LINE_END.END),
    );
  }
}

/** Marks an element deleted, with its label and, for a shape, every arrow bound to it. */
function remove(scene: Scene, id: string): void {
  const element = scene.live(id);
  if (!element) return;
  scene.change(id, { isDeleted: true });
  for (const ref of boundRefs(element)) {
    if (ref.type === BOARD_ELEMENT_TYPE.ARROW) remove(scene, ref.id);
    else if (scene.live(ref.id)) scene.change(ref.id, { isDeleted: true });
  }
  unbindFrom(scene, element.startBinding?.elementId, id);
  unbindFrom(scene, element.endBinding?.elementId, id);
}

function add(scene: Scene, skeleton: BoardSkeleton): Result.Result<void, string> {
  if (scene.live(skeleton.id)) return Result.fail(BOARD_OP_REFUSAL.ID_TAKEN);
  const base = baseElement(skeleton.id, skeleton.type, scene.nextVersion(skeleton.id), scene.now);
  const stroke = skeleton.strokeColor ?? DEFAULT.STROKE;
  switch (skeleton.type) {
    case BOARD_ELEMENT_TYPE.TEXT: {
      const fontSize = skeleton.fontSize ?? DEFAULT.FONT_SIZE;
      scene.put({
        ...base,
        x: skeleton.x,
        y: skeleton.y,
        strokeColor: stroke,
        ...textFields(skeleton.text, fontSize, null),
        ...textSize(skeleton.text, fontSize),
      });
      break;
    }
    case BOARD_ELEMENT_TYPE.LINE: {
      const [first] = skeleton.points;
      const originX = first?.x ?? 0;
      const originY = first?.y ?? 0;
      const xs = skeleton.points.map((point) => point.x);
      const ys = skeleton.points.map((point) => point.y);
      scene.put({
        ...base,
        x: originX,
        y: originY,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        strokeColor: stroke,
        points: skeleton.points.map((point) => [point.x - originX, point.y - originY]),
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null,
        lastCommittedPoint: null,
      });
      break;
    }
    case BOARD_ELEMENT_TYPE.ARROW: {
      const from = endpointShape(scene, skeleton.from);
      if (Result.isFailure(from)) return Result.fail(from.failure);
      const to = endpointShape(scene, skeleton.to);
      if (Result.isFailure(to)) return Result.fail(to.failure);
      scene.put({
        ...base,
        strokeColor: stroke,
        roundness: { type: EXCALIDRAW.ROUNDNESS_PROPORTIONAL },
        startArrowhead: null,
        endArrowhead: "arrow",
        lastCommittedPoint: null,
        elbowed: false,
        startBinding: null,
        endBinding: null,
        points: [
          [0, 0],
          [0, 0],
        ],
      });
      const placed = scene.live(skeleton.id);
      if (placed) routeArrow(scene, placed, from.success, to.success);
      break;
    }
    default:
      scene.put({
        ...base,
        x: skeleton.x,
        y: skeleton.y,
        width: skeleton.width ?? DEFAULT.WIDTH,
        height: skeleton.height ?? DEFAULT.HEIGHT,
        strokeColor: stroke,
        backgroundColor: skeleton.backgroundColor ?? DEFAULT.BACKGROUND,
        roundness:
          skeleton.type === BOARD_ELEMENT_TYPE.RECTANGLE
            ? { type: EXCALIDRAW.ROUNDNESS_ADAPTIVE }
            : skeleton.type === BOARD_ELEMENT_TYPE.DIAMOND
              ? { type: EXCALIDRAW.ROUNDNESS_PROPORTIONAL }
              : null,
      });
  }
  scene.added(skeleton.id);
  const label = "label" in skeleton ? skeleton.label : undefined;
  if (label) setLabel(scene, skeleton.id, label);
  return Result.succeed(undefined);
}

function update(scene: Scene, op: typeof updateOp.Type): Result.Result<void, string> {
  const element = scene.live(op.id);
  if (!element) return Result.fail(BOARD_OP_REFUSAL.NO_ELEMENT);
  const isArrow = element.type === BOARD_ELEMENT_TYPE.ARROW;
  if ((op.from !== undefined || op.to !== undefined) && !isArrow) {
    return Result.fail(BOARD_OP_REFUSAL.NOT_AN_ARROW);
  }
  if (op.label !== undefined && element.type === BOARD_ELEMENT_TYPE.LINE) {
    return Result.fail(BOARD_OP_REFUSAL.NOT_LABELLED);
  }
  const from = op.from === undefined ? undefined : endpointShape(scene, op.from);
  if (from && Result.isFailure(from)) return Result.fail(from.failure);
  const to = op.to === undefined ? undefined : endpointShape(scene, op.to);
  if (to && Result.isFailure(to)) return Result.fail(to.failure);
  const fields = [
    ["x", op.x],
    ["y", op.y],
    ["width", isArrow ? undefined : op.width],
    ["height", isArrow ? undefined : op.height],
    ["strokeColor", op.strokeColor],
    ["backgroundColor", op.backgroundColor],
  ] as const;
  let moved = false;
  for (const [field, value] of fields) {
    if (value === undefined) continue;
    scene.change(op.id, { [field]: value });
    moved = true;
  }
  if (op.label !== undefined && element.type === BOARD_ELEMENT_TYPE.TEXT) {
    const fontSize = element.fontSize ?? DEFAULT.FONT_SIZE;
    if (op.label.length === 0) remove(scene, op.id);
    else
      scene.change(op.id, {
        ...textFields(op.label, fontSize, element.containerId ?? null),
        ...textSize(op.label, fontSize),
      });
  } else if (op.label !== undefined && LABELLED.has(element.type)) {
    setLabel(scene, op.id, op.label);
  }
  const current = scene.live(op.id);
  if (current && isArrow && (from || to)) {
    routeArrow(
      scene,
      current,
      from ? from.success : standingEnd(scene, current, LINE_END.START),
      to ? to.success : standingEnd(scene, current, LINE_END.END),
    );
  } else if (current && moved) {
    follow(scene, op.id);
  }
  return Result.succeed(undefined);
}

function applyOne(scene: Scene, op: BoardOp): Result.Result<void, string> {
  switch (op.op) {
    case BOARD_OP.ADD:
      return add(scene, op.element);
    case BOARD_OP.UPDATE:
      return update(scene, op);
    case BOARD_OP.REMOVE:
      if (!scene.live(op.id)) return Result.fail(BOARD_OP_REFUSAL.NO_ELEMENT);
      remove(scene, op.id);
      return Result.succeed(undefined);
    case BOARD_OP.CLEAR:
      for (const element of scene.liveElements()) remove(scene, element.id);
      return Result.succeed(undefined);
  }
}

/**
 * The board's elements with every operation applied in order, or the first
 * operation refused with why; a refusal changes nothing. `now` stamps what
 * changed.
 */
export function applyBoardOps(
  elements: readonly BoardElement[],
  ops: readonly BoardOp[],
  now: number,
): Result.Result<readonly BoardElement[], BoardOpRefusal> {
  const scene = new Scene(elements, now);
  for (const [at, op] of ops.entries()) {
    const applied = applyOne(scene, op);
    if (Result.isFailure(applied)) return Result.fail({ at, reason: applied.failure });
  }
  const next = scene.elements();
  if (next.length > BOARD_BOUNDS.MAX_ELEMENTS || !boardFitsBytes(next)) {
    return Result.fail({ at: ops.length - 1, reason: BOARD_OP_REFUSAL.TOO_LARGE });
  }
  return Result.succeed(next);
}
