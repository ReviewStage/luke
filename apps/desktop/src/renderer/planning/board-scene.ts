import {
  BOARD_ELEMENT_TYPE,
  type BoardElement,
  boardElementSchema,
} from "@sidecar/hosted/board-wire";
import { Schema } from "effect";

/**
 * board-scene.ts -- the canvas's scene held to what a board admits, before the panel asks for it saved.
 *
 * Excalidraw holds element types a board does not: a pasted image, an
 * embedded page, a frame of its own kinds. Those stay on the canvas of this
 * Mac and never reach the service, which would refuse the whole scene for
 * one of them; everything else is read under the board's own element
 * schema, so what leaves is what the service reads.
 */

const isBoardElement = Schema.is(Schema.toType(boardElementSchema));
const ADMITTED_TYPES: ReadonlySet<string> = new Set(Object.values(BOARD_ELEMENT_TYPE));

/** The scene's elements a board admits, in order; an image, an embed, or anything else of its own is left out. */
export function admittedElements(elements: readonly object[]): readonly BoardElement[] {
  return elements.filter(
    (element): element is BoardElement =>
      "type" in element && ADMITTED_TYPES.has(String(element.type)) && isBoardElement(element),
  );
}
