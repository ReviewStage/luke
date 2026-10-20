import type { AppState } from "@excalidraw/excalidraw/types";
import { coarsePointerNow } from "../coarse-pointer.js";

/**
 * opening-view.ts -- the view the whiteboard's canvas opens on: transparent over the panel, and in the hand where a finger works it.
 *
 * Worked by a finger, the board opens with the hand in it, so a finger
 * dragged across the canvas moves the view, as it does on every other page
 * a phone shows, rather than drawing a selection box. Two fingers pan and
 * pinch in every tool, as Excalidraw already takes them, and a tool chosen
 * from the toolbar draws as it does with a mouse. A mouse opens on
 * Excalidraw's own selection, as it always has.
 *
 * Note that the pointer is asked as the board mounts, because Excalidraw
 * takes its opening tool once, from `initialData`, and that this module
 * holds no Excalidraw value, so the panel's tests read it without the
 * canvas Excalidraw needs to load.
 */

/** The tool Excalidraw's hand is, as its app state holds a tool. */
const HAND = { type: "hand", customType: null, lastActiveTool: null, locked: false } as const;

/** The app state the canvas opens on, for the device's pointer as it stands. */
export function openingView(): Partial<AppState> {
  const ground = { viewBackgroundColor: "transparent" };
  return coarsePointerNow() ? { ...ground, activeTool: HAND } : ground;
}
