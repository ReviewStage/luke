import type { Board } from "@sidecar/hosted/board-wire";

/**
 * contract.ts -- what the panel and the whiteboard bundle say to each other: the one mount call, and the scene rule both sides read.
 *
 * Excalidraw is too large for the bundle every window parses, so it ships as
 * a bundle of its own (`whiteboard.js`, built from `./index.tsx`) that the
 * Plans tab loads the first time a board is shown. That bundle sets one
 * global, `window.lukeWhiteboard`, and this file is the whole of what the two
 * share: no Excalidraw type crosses, only the board's own wire shape, and
 * nothing here imports a value, so the whiteboard bundle carries none of the
 * panel's libraries.
 *
 * The canvas opens on the board's scene and from then on holds it: a later
 * board matters only for a drawing of Luke's newer than the one the canvas
 * holds, which it puts in place of his previous one. The canvas asks to save
 * only when its scene changed, which `sceneSignature` decides: Excalidraw
 * raises an element's version on every change, so the count and the sum of
 * versions move exactly when the scene does, and not when a selection or the
 * view moves. What it sends is held to the types a board admits on the
 * panel's side (`planning/board-scene.ts`), so a pasted image or embed stays
 * on this Mac and never reaches the service.
 */

/** What the panel hands the board when it mounts it. */
export interface WhiteboardProps {
  /** The board the canvas opens on. */
  readonly board: Board;
  /** The scene changed: every element as Excalidraw holds it, and the number of Luke's drawing it holds. */
  readonly onScene: (elements: readonly object[], appliedDrawing: number) => void;
}

/** The board as mounted: show a later board, and take the board down. */
export interface WhiteboardHandle {
  readonly show: (board: Board) => void;
  readonly unmount: () => void;
}

/** What the whiteboard bundle sets on `window` once it has loaded. */
export interface WhiteboardModule {
  readonly mount: (host: HTMLElement, props: WhiteboardProps) => WhiteboardHandle;
  /**
   * A scene the canvas reported, drawn whole as a PNG in the canvas's own
   * theme, base64, for the planning model to look at; nothing where it could
   * not be drawn. Drawn off the document, and never a rejection.
   */
  readonly render: (elements: readonly object[]) => Promise<string | undefined>;
}

declare global {
  interface Window {
    lukeWhiteboard?: WhiteboardModule;
  }
}

/** The files the whiteboard bundle is, beside `index.html`. */
export const WHITEBOARD_ASSET = {
  SCRIPT: "whiteboard.js",
  STYLESHEET: "whiteboard.css",
} as const;

/** The scene's identity for saving: its element count and the sum of their versions. */
export function sceneSignature(elements: readonly { readonly version: number }[]): string {
  let versions = 0;
  for (const element of elements) versions += element.version;
  return `${elements.length}:${versions}`;
}
