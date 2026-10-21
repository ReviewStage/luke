/**
 * use-call-tile-width.ts -- how wide the avatar's tile stands at an agent's tab's foot, kept across launches in the window's own storage.
 *
 * The tile is square, so its width is its size. The developer drags its
 * edge between `CALL_TILE_WIDTH`'s bounds, and the width they leave it at is
 * kept in the renderer's storage, as the side panel's and the sidebar's are,
 * so the next call opens on the tile they had. A width kept outside the
 * bounds, by an older build or by hand, is held to them as it is read.
 */

import { Option, Schema } from "effect";
import { useCallback, useState } from "react";

/**
 * The tile's widths in CSS pixels: the least at which Luke's still face and
 * what the tile says still read, the most past which it covers more of the
 * transcript than a picture of a face is worth, and the one a first call
 * and a double-click on its edge give it.
 */
export const CALL_TILE_WIDTH = {
  MIN: 120,
  MAX: 360,
  DEFAULT: 180,
} as const;

/** Where the width is kept in the renderer's storage. */
const STORAGE_KEY = "luke.callTileWidth";

const decodeWidth = Schema.decodeUnknownOption(Schema.FiniteFromString);

function clampWidth(width: number): number {
  return Math.min(CALL_TILE_WIDTH.MAX, Math.max(CALL_TILE_WIDTH.MIN, Math.round(width)));
}

/** The kept width, or the default where none is kept, it no longer reads, or storage refuses the read. */
function readWidth(): number {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // The default stands.
  }
  return clampWidth(Option.getOrElse(decodeWidth(stored), () => CALL_TILE_WIDTH.DEFAULT));
}

/** The tile's width, and the door a drag or a key asks for another through, held to the bounds and kept. */
export function useCallTileWidth(): { width: number; onResize: (width: number) => void } {
  const [width, setWidth] = useState(readWidth);
  const onResize = useCallback((asked: number) => {
    const kept = clampWidth(asked);
    setWidth(kept);
    // A write that fails costs only the preference, so it is not worth a word on screen.
    try {
      window.localStorage.setItem(STORAGE_KEY, String(kept));
    } catch {
      // The tile keeps the width it holds.
    }
  }, []);
  return { width, onResize };
}
