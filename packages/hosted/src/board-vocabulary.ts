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
