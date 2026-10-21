/**
 * use-call-video-size.ts -- how tall Luke's video stands above an agent's composer while a call is up, snapped to S, M and L and kept across launches in the window's own storage.
 *
 * The video keeps its own aspect, so its height is its size. It starts at
 * S. The developer drags a top corner between `CALL_VIDEO_HEIGHT`'s bounds,
 * a drag landing near S, M or L settling on it, or picks one of the three;
 * the height they leave it at is kept in the renderer's storage, as the side
 * panel's and the sidebar's widths are, so the next call opens on the video
 * they had. A height kept outside the bounds, by hand, is held to them as it
 * is read.
 */

import { Option, Schema } from "effect";
import { useCallback, useState } from "react";

/** The sizes the video's control offers. */
export const CALL_VIDEO_SIZE = {
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
} as const;

export type CallVideoSize = (typeof CALL_VIDEO_SIZE)[keyof typeof CALL_VIDEO_SIZE];

/** Each size's height in CSS pixels. */
export const CALL_VIDEO_SIZE_HEIGHT = {
  [CALL_VIDEO_SIZE.SMALL]: 120,
  [CALL_VIDEO_SIZE.MEDIUM]: 200,
  [CALL_VIDEO_SIZE.LARGE]: 300,
} as const satisfies Record<CallVideoSize, number>;

/**
 * The video's heights in CSS pixels: the least at which Luke's face still
 * reads, the most past which it takes more of the tab than a face is worth,
 * and the one a first call opens on, S.
 */
export const CALL_VIDEO_HEIGHT = {
  MIN: 96,
  MAX: 360,
  DEFAULT: CALL_VIDEO_SIZE_HEIGHT[CALL_VIDEO_SIZE.SMALL],
} as const;

/** How near a size, in CSS pixels, a drag lands before it settles on that size. */
const SNAP_DISTANCE = 8;

/** Where the height is kept in the renderer's storage. */
const STORAGE_KEY = "luke.callVideoHeight";

const decodeHeight = Schema.decodeUnknownOption(Schema.FiniteFromString);

const SIZES = Object.values(CALL_VIDEO_SIZE);

/** A height held to the video's bounds, in whole pixels. */
export function clampCallVideoHeight(height: number): number {
  return Math.min(CALL_VIDEO_HEIGHT.MAX, Math.max(CALL_VIDEO_HEIGHT.MIN, Math.round(height)));
}

/** A dragged height held to the bounds, settled on S, M or L where it lands near one. */
export function snapCallVideoHeight(height: number): number {
  const held = clampCallVideoHeight(height);
  const near = SIZES.find((size) => Math.abs(CALL_VIDEO_SIZE_HEIGHT[size] - held) <= SNAP_DISTANCE);
  return near === undefined ? held : CALL_VIDEO_SIZE_HEIGHT[near];
}

/** The size the height is, where it is one of the three. */
export function callVideoSizeOf(height: number): CallVideoSize | undefined {
  return SIZES.find((size) => CALL_VIDEO_SIZE_HEIGHT[size] === height);
}

/** The kept height, or S where none is kept, it no longer reads, or storage refuses the read. */
function readHeight(): number {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // S stands.
  }
  return clampCallVideoHeight(
    Option.getOrElse(decodeHeight(stored), () => CALL_VIDEO_HEIGHT.DEFAULT),
  );
}

/** The video's height, and the door a drag, a key, or a size asks for another through, held to the bounds and kept. */
export function useCallVideoHeight(): { height: number; onResize: (height: number) => void } {
  const [height, setHeight] = useState(readHeight);
  const onResize = useCallback((asked: number) => {
    const kept = clampCallVideoHeight(asked);
    setHeight(kept);
    // A write that fails costs only the preference, so it is not worth a word on screen.
    try {
      window.localStorage.setItem(STORAGE_KEY, String(kept));
    } catch {
      // The video keeps the height it holds.
    }
  }, []);
  return { height, onResize };
}
