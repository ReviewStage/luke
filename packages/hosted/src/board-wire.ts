import { WireValueSchema } from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import { countedNumber } from "./service-wire.js";

/**
 * board-wire.ts -- a plan's whiteboard: the Excalidraw scene Luke and the developer both draw on, as the service stores it and the Plans tab reads it.
 *
 * A board is one plan's list of Excalidraw elements and a revision. Both
 * writers replace the list whole, each under the revision it read, so a
 * write made over a board that moved meanwhile is refused and the writer
 * merges and tries again; the revision is the only thing that orders them.
 * Luke writes through `draw_on_board`, whose operations the service turns
 * into elements itself (`board-skeleton.ts`); the developer writes what the
 * Excalidraw canvas holds. Neither ever drops an element: a removal marks it
 * `isDeleted` and bumps its version, so a merge by element version cannot
 * bring back what the other side removed.
 *
 * An element is typed in the fields the service reads (`board-text.ts`
 * renders them for the model) and carries Excalidraw's other fields as
 * opaque wire values, so a newer canvas's properties pass through intact.
 * The types a board admits leave out every element that holds a file, a
 * page, or an embedded frame, since nothing else on this wire carries one.
 */

export const BOARD_BOUNDS = {
  /** The most elements a board holds, deleted ones included. */
  MAX_ELEMENTS: 2_000,
  /** The most bytes a board's elements may serialize to. */
  MAX_BYTES: 512 * 1024,
  /** The most characters one text element may spell. */
  MAX_TEXT_CHARS: 4_000,
  /** The most characters an element id may spell. */
  MAX_ID_CHARS: 64,
  /** The most deleted elements a board keeps for merging; older ones are dropped on write. */
  MAX_TOMBSTONES: 500,
} as const;

/** Who wrote a board's current revision. */
export const BOARD_AUTHOR = {
  LUKE: "luke",
  DEVELOPER: "developer",
} as const;

export type BoardAuthor = (typeof BOARD_AUTHOR)[keyof typeof BOARD_AUTHOR];

/** The Excalidraw element types a board admits. */
export const BOARD_ELEMENT_TYPE = {
  RECTANGLE: "rectangle",
  ELLIPSE: "ellipse",
  DIAMOND: "diamond",
  TEXT: "text",
  ARROW: "arrow",
  LINE: "line",
  FREEDRAW: "freedraw",
  FRAME: "frame",
} as const;

export type BoardElementType = (typeof BOARD_ELEMENT_TYPE)[keyof typeof BOARD_ELEMENT_TYPE];

const elementIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_ID_CHARS),
);

/** Where an arrow's end is attached: the element it is bound to. */
const pointBindingSchema = EffectSchema.StructWithRest(
  EffectSchema.Struct({ elementId: elementIdSchema }),
  [EffectSchema.Record(EffectSchema.String, WireValueSchema)],
);

/** The fields of an element the service reads. */
const boardElementFields = EffectSchema.Struct({
  id: elementIdSchema,
  type: EffectSchema.Literals(Object.values(BOARD_ELEMENT_TYPE)),
  x: EffectSchema.Finite,
  y: EffectSchema.Finite,
  width: EffectSchema.Finite,
  height: EffectSchema.Finite,
  version: EffectSchema.Int,
  isDeleted: EffectSchema.Boolean,
  /** Epoch milliseconds of the element's latest change. */
  updated: EffectSchema.optionalKey(EffectSchema.Finite),
  text: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_TEXT_CHARS)),
  ),
  fontSize: EffectSchema.optionalKey(EffectSchema.Finite),
  containerId: EffectSchema.optionalKey(EffectSchema.NullOr(elementIdSchema)),
  /** What is attached to it: its label, and the arrows bound to it. */
  boundElements: EffectSchema.optionalKey(
    EffectSchema.NullOr(
      EffectSchema.Array(EffectSchema.Struct({ id: elementIdSchema, type: EffectSchema.String })),
    ),
  ),
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

/** A board's elements, bounded in count. */
export const boardElementsSchema = EffectSchema.Array(boardElementSchema).check(
  EffectSchema.isMaxLength(BOARD_BOUNDS.MAX_ELEMENTS),
);

/** A plan's board as it stands: revision 0 with no elements before anything was drawn. */
export const boardSchema = EffectSchema.Struct({
  revision: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  elements: boardElementsSchema,
  /** Who wrote this revision; absent before the first. */
  updatedBy: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(BOARD_AUTHOR))),
  /** Epoch milliseconds of this revision; absent before the first. */
  updatedAt: EffectSchema.optionalKey(countedNumber),
});

export type Board = typeof boardSchema.Type;

/** A board read (GET). */
export const boardAnswerSchema = EffectSchema.Struct({ board: boardSchema });

/** The developer's save (PUT): the whole scene, written over the revision it was drawn on. */
export const boardSaveRequestSchema = EffectSchema.Struct({
  baseRevision: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  elements: boardElementsSchema,
});

export const BOARD_SAVE = {
  SAVED: "saved",
  CONFLICT: "conflict",
} as const;

/** A save's answer: the board as it now stands, saved, or moved past the base and left unwritten. */
export const boardSaveAnswerSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literals(Object.values(BOARD_SAVE)),
  board: boardSchema,
});

/** The board before anything was drawn on it. */
export const EMPTY_BOARD: Board = { revision: 0, elements: [] };

/** The two ends of an arrow or a line. */
export const LINE_END = {
  START: "start",
  END: "end",
} as const;

export type LineEnd = (typeof LINE_END)[keyof typeof LINE_END];

/** A place on the board, in board pixels. */
export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

/** Where a line or an arrow's first or last point stands on the board; a shape's corner, for a shape. */
export function lineEnd(element: BoardElement, which: LineEnd): BoardPoint {
  const points = element.points ?? [];
  const point = which === LINE_END.START ? points[0] : points[points.length - 1];
  return { x: element.x + (point?.[0] ?? 0), y: element.y + (point?.[1] ?? 0) };
}

/** Whether elements fit the board's byte bound once serialized. */
export function boardFitsBytes(elements: readonly BoardElement[]): boolean {
  return new TextEncoder().encode(JSON.stringify(elements)).length <= BOARD_BOUNDS.MAX_BYTES;
}

/**
 * The elements with every deleted one past the newest `MAX_TOMBSTONES`
 * dropped, order kept. Note that we keep tombstones at all because a merge
 * by version needs one to know a removal is newer than a stale copy; the
 * oldest are dropped because a copy that stale is long gone.
 */
export function pruneTombstones(elements: readonly BoardElement[]): readonly BoardElement[] {
  const deleted = elements.filter((element) => element.isDeleted);
  if (deleted.length <= BOARD_BOUNDS.MAX_TOMBSTONES) return elements;
  const updatedOf = (element: BoardElement) => element.updated ?? 0;
  const kept = new Set(
    [...deleted]
      .sort((left, right) => updatedOf(right) - updatedOf(left))
      .slice(0, BOARD_BOUNDS.MAX_TOMBSTONES),
  );
  return elements.filter((element) => !element.isDeleted || kept.has(element));
}
