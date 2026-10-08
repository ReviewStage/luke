/**
 * board-vocabulary.ts -- the whiteboard's fixed words, apart from its schemas, so the canvas's own bundle can read them without carrying Effect.
 *
 * The Mac's whiteboard is a bundle of its own, loaded only when a board is
 * shown, and it reads these to tell one kind of element from another. Its
 * schemas stay in `board-wire.ts`, which this file must never import.
 */

/**
 * The planning model's tool that draws on a board. The Mac reads it off the
 * planning call's activity, where a pending call names its tool, to know a
 * drawing just landed and read the board again.
 */
export const DRAW_ON_BOARD_TOOL_NAME = "draw_on_board";

/** The Excalidraw element types a scene admits. */
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

/**
 * The mark the Mac's canvas sets in `customData` on every element it made
 * from one of Luke's drawings, so the service and the model can tell his
 * elements from the developer's.
 */
export const LUKE_MARK = { drawnBy: "luke" } as const;

/**
 * The steps of a drawing that draw nothing themselves, after Excalidraw's own
 * agent format: one moves the viewport, the other takes elements off.
 */
export const DRAWING_STEP_TYPE = {
  CAMERA: "cameraUpdate",
  DELETE: "delete",
} as const;
