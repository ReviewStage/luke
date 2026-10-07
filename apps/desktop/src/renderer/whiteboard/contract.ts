import type { Board } from "@sidecar/hosted/board-wire";

/**
 * contract.ts -- what the panel and the whiteboard bundle say to each other: the one mount call, and the scene rules both sides read.
 *
 * Excalidraw is too large for the bundle every window parses, so it ships as
 * a bundle of its own (`whiteboard.js`, built from `./index.tsx`) that the
 * Plans tab loads the first time a board is shown. That bundle sets one
 * global, `window.lukeWhiteboard`, and this file is the whole of what the two
 * share: no Excalidraw type crosses, only the board's own wire shape, and
 * nothing here imports a value, so the whiteboard bundle carries none of the
 * panel's libraries.
 *
 * The board the panel shows is merged into the canvas rather than swapped
 * in, so a stroke the developer is drawing is never lost to a draw of
 * Luke's. The canvas asks to save only when its scene differs from the last
 * board the service holds, which `sceneSignature` decides: Excalidraw raises
 * an element's version on every change, so the count and the sum of versions
 * move exactly when the scene does, and not when a selection or the view
 * moves. What it sends is held to the types a board admits on the panel's
 * side (`planning/board-scene.ts`), so a pasted image or embed stays on this
 * Mac and never reaches the service.
 */

/** What the panel hands the board when it mounts it. */
export interface WhiteboardProps {
  /** The board the canvas opens on. */
  readonly board: Board;
  /** The developer changed the scene: every element, the erased ones included, as Excalidraw holds them. */
  readonly onScene: (elements: readonly object[]) => void;
}

/** The board as mounted: show the service's board, and take the board down. */
export interface WhiteboardHandle {
  readonly show: (board: Board) => void;
  readonly unmount: () => void;
}

/** What the whiteboard bundle sets on `window` once it has loaded. */
export interface WhiteboardModule {
  readonly mount: (host: HTMLElement, props: WhiteboardProps) => WhiteboardHandle;
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
