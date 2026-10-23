/**
 * use-call-video-size.ts -- how tall Luke's video stands above an agent's composer while a call is up, and kept across launches in the window's own storage.
 *
 * The video keeps its own aspect, so its height is its size. It starts at
 * 120 px. The developer drags a top corner, or steps it from the keyboard,
 * between `CALL_VIDEO_HEIGHT`'s bounds; the height they leave it at is kept in the renderer's storage, as the side
 * panel's and the sidebar's widths are, so the next call opens on the video
 * they had. A height kept outside the bounds, by hand, is held to them as it
 * is read.
 */

import { Schema } from "effect";
import { useCallback, useState } from "react";
import { readKept, writeKept } from "../kept-storage.js";

/**
 * The video's heights in CSS pixels: the least at which Luke's face still
 * reads, the most past which it takes more of the tab than a face is worth,
 * and the one a first call opens on.
 */
export const CALL_VIDEO_HEIGHT = {
  MIN: 96,
  MAX: 360,
  DEFAULT: 120,
} as const;

/** Where the height is kept in the renderer's storage. */
const STORAGE_KEY = "luke.callVideoHeight";

/** A height held to the video's bounds, in whole pixels. */
export function clampCallVideoHeight(height: number): number {
  return Math.min(CALL_VIDEO_HEIGHT.MAX, Math.max(CALL_VIDEO_HEIGHT.MIN, Math.round(height)));
}

/** The kept height, or the default where none is kept, it no longer reads, or storage refuses the read. */
function readHeight(): number {
  return clampCallVideoHeight(
    readKept(STORAGE_KEY, Schema.FiniteFromString, CALL_VIDEO_HEIGHT.DEFAULT),
  );
}

/** The video's height, and the door a drag or a key asks for another through, held to the bounds and kept. */
export function useCallVideoHeight(): { height: number; onResize: (height: number) => void } {
  const [height, setHeight] = useState(readHeight);
  const onResize = useCallback((asked: number) => {
    const kept = clampCallVideoHeight(asked);
    setHeight(kept);
    writeKept(STORAGE_KEY, Schema.FiniteFromString, kept);
  }, []);
  return { height, onResize };
}
