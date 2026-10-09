import { WireValueSchema } from "@sidecar/wire";
import { declareReader, describeWire, emitJsonSchema, readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { BOARD_ELEMENT_TYPE, DRAWING_ZONE } from "./board-vocabulary.js";

/**
 * board-wire.ts -- a plan's whiteboard: the Excalidraw scene on it, and Luke's latest drawing for it, as the service stores them and the Plans tab reads them.
 *
 * A board is two things. The scene is the Excalidraw elements the Plans tab
 * shows, written whole by the Mac, the last write winning. Luke's drawing is
 * the diagram the planning model last drew (`draw_on_board`), kept in the
 * small vocabulary below rather than as Excalidraw's own records, because
 * only the Mac's canvas can measure text and lay out what Excalidraw makes of
 * it. Each drawing is numbered, and the scene says which drawing it holds:
 * when the Mac reads a drawing newer than that, it converts the drawing with
 * Excalidraw's own converter, puts it in place of Luke's previous one beside
 * whatever the developer drew, and writes the scene back.
 *
 * A scene element is typed in the fields the service reads (`board-text.ts`
 * renders them for the model) and carries Excalidraw's other fields as opaque
 * wire values. The types a scene admits leave out every element that holds a
 * file, a page, or an embedded frame.
 */

export const BOARD_BOUNDS = {
  /** The most elements a scene holds. */
  MAX_ELEMENTS: 2_000,
  /** The most bytes a scene's elements may serialize to. */
  MAX_BYTES: 512 * 1024,
  /** The most characters one text element or label may spell. */
  MAX_TEXT_CHARS: 4_000,
  /** The most characters an element id may spell. */
  MAX_ID_CHARS: 64,
  /** The most elements one drawing of Luke's holds. */
  MAX_DRAWING_ELEMENTS: 100,
} as const;

const elementIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_ID_CHARS),
);

const textSchema = EffectSchema.String.check(EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_TEXT_CHARS));

/** Where an arrow's end is attached: the element it is bound to. */
const pointBindingSchema = EffectSchema.StructWithRest(
  EffectSchema.Struct({ elementId: elementIdSchema }),
  [EffectSchema.Record(EffectSchema.String, WireValueSchema)],
);

/** The fields of a scene element the service reads. */
const boardElementFields = EffectSchema.Struct({
  id: elementIdSchema,
  type: EffectSchema.Literals(Object.values(BOARD_ELEMENT_TYPE)),
  x: EffectSchema.Finite,
  y: EffectSchema.Finite,
  width: EffectSchema.Finite,
  height: EffectSchema.Finite,
  text: EffectSchema.optionalKey(textSchema),
  containerId: EffectSchema.optionalKey(EffectSchema.NullOr(elementIdSchema)),
  startBinding: EffectSchema.optionalKey(
    EffectSchema.NullOr(EffectSchema.Struct({ elementId: elementIdSchema })),
  ),
  endBinding: EffectSchema.optionalKey(
    EffectSchema.NullOr(EffectSchema.Struct({ elementId: elementIdSchema })),
  ),
  points: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Array(EffectSchema.Finite).check(
        EffectSchema.isMinLength(2),
        EffectSchema.isMaxLength(2),
      ),
    ),
  ),
});

const readElementRecord = readEither(
  EffectSchema.StructWithRest(
    EffectSchema.Struct({
      ...boardElementFields.fields,
      startBinding: EffectSchema.optionalKey(EffectSchema.NullOr(pointBindingSchema)),
      endBinding: EffectSchema.optionalKey(EffectSchema.NullOr(pointBindingSchema)),
    }),
    [EffectSchema.Record(EffectSchema.String, WireValueSchema)],
  ),
);

/**
 * One Excalidraw element: the fields the service reads typed, the rest
 * carried as they came. Note that the node it shows names the typed fields
 * alone, because the wire's JSON Schema has no open object; the reader
 * behind it admits the rest, as `reads-wire.ts` does for a stored message.
 */
export const boardElementSchema = declareReader(
  (value) =>
    Result.match(readElementRecord(value), {
      onFailure: (error) => ({ ok: false, refusal: error.refusal, path: error.path }),
      onSuccess: (element) => ({ ok: true, value: element }),
    }),
  emitJsonSchema(boardElementFields),
);

export type BoardElement = typeof boardElementSchema.Type;

/** A scene's elements, bounded in count. */
export const boardElementsSchema = EffectSchema.Array(boardElementSchema).check(
  EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_ELEMENTS),
);

/** The ids Luke gives what he draws, which he names again to connect arrows. */
const DRAWING_ID = describeWire(
  EffectSchema.String.check(
    EffectSchema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
    EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_ID_CHARS),
  ),
  'A short kebab-case id, such as "api" or "db", which arrows name to connect it.',
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
  EffectSchema.String.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(500)),
  "Words drawn inside it.",
);

const COLOR = describeWire(
  EffectSchema.String.check(EffectSchema.isPattern(/^(#[0-9a-fA-F]{6}|transparent)$/)),
  'A hex color such as "#1971c2", or "transparent".',
);

/** The drawing's shapes: closed outlines that may carry a label. */
const DRAWING_SHAPE = {
  RECTANGLE: BOARD_ELEMENT_TYPE.RECTANGLE,
  ELLIPSE: BOARD_ELEMENT_TYPE.ELLIPSE,
  DIAMOND: BOARD_ELEMENT_TYPE.DIAMOND,
} as const;

const drawingShapeSchema = EffectSchema.Struct({
  type: EffectSchema.Literals(Object.values(DRAWING_SHAPE)),
  id: DRAWING_ID,
  x: describeWire(COORDINATE, "Left edge, in pixels."),
  y: describeWire(COORDINATE, "Top edge, in pixels."),
  width: EffectSchema.optionalKey(describeWire(SIZE, "Width in pixels; 200 when left out.")),
  height: EffectSchema.optionalKey(describeWire(SIZE, "Height in pixels; 80 when left out.")),
  label: EffectSchema.optionalKey(LABEL),
  strokeColor: EffectSchema.optionalKey(COLOR),
  backgroundColor: EffectSchema.optionalKey(COLOR),
});

const drawingTextSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BOARD_ELEMENT_TYPE.TEXT),
  id: DRAWING_ID,
  x: describeWire(COORDINATE, "Left edge, in pixels."),
  y: describeWire(COORDINATE, "Top edge, in pixels."),
  text: EffectSchema.String.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(2_000)),
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

const drawingZoneSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(DRAWING_ZONE),
  id: DRAWING_ID,
  x: describeWire(COORDINATE, "Left edge, in pixels."),
  y: describeWire(COORDINATE, "Top edge, in pixels."),
  width: describeWire(SIZE, "Width in pixels, with room for the shapes inside it."),
  height: describeWire(SIZE, "Height in pixels, with room for the shapes inside it."),
  title: EffectSchema.optionalKey(
    describeWire(
      EffectSchema.String.check(EffectSchema.isNonEmpty(), EffectSchema.isMaxLength(200)),
      "Words drawn at its top-left corner, clear of the shapes inside it.",
    ),
  ),
  strokeColor: EffectSchema.optionalKey(COLOR),
  backgroundColor: EffectSchema.optionalKey(COLOR),
});

const drawingArrowSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BOARD_ELEMENT_TYPE.ARROW),
  id: DRAWING_ID,
  from: describeWire(DRAWING_ID, "The id of the shape the arrow starts at."),
  to: describeWire(DRAWING_ID, "The id of the shape the arrow points to."),
  label: EffectSchema.optionalKey(LABEL),
  strokeColor: EffectSchema.optionalKey(COLOR),
});

const drawingElementSchema = EffectSchema.Union([
  drawingShapeSchema,
  drawingTextSchema,
  drawingZoneSchema,
  drawingArrowSchema,
]);

export type DrawingElement = typeof drawingElementSchema.Type;

/** One drawing of Luke's: the whole diagram, which replaces his previous one. */
export const drawingElementsSchema = describeWire(
  EffectSchema.Array(drawingElementSchema).check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_DRAWING_ELEMENTS),
  ),
  "The whole diagram, every shape, text, zone, and arrow in it.",
);

/** A plan's board as it stands: the empty scene and no drawing before anything was drawn. */
export const boardSchema = EffectSchema.Struct({
  elements: boardElementsSchema,
  /** The number of Luke's drawing the scene holds; 0 before it holds any. */
  appliedDrawing: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  /** Luke's latest drawing and its number; absent before he drew. */
  drawing: EffectSchema.optionalKey(
    EffectSchema.Struct({
      number: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
      elements: EffectSchema.Array(drawingElementSchema),
    }),
  ),
});

export type Board = typeof boardSchema.Type;

/** A board read (GET), and what a scene's write answers (PUT). */
export const boardAnswerSchema = EffectSchema.Struct({ board: boardSchema });

/** The Mac's write (PUT): the whole scene, and the number of Luke's drawing it holds. */
export const boardSaveRequestSchema = EffectSchema.Struct({
  elements: boardElementsSchema,
  appliedDrawing: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

/** The board before anything was drawn on it. */
export const EMPTY_BOARD: Board = { elements: [], appliedDrawing: 0 };
