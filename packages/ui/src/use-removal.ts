import { useLayoutEffect, useRef, useState } from "react";
import { useDisclosure } from "./use-disclosure.js";

/**
 * use-removal.ts -- holds a thing its own × takes away drawn through its exit, and asks its caller to take it once the exit is done.
 *
 * docs/DESIGN.md has an element that unmounts held mounted through its own
 * exit. A chip's caller takes the chip away the moment its `onRemove`
 * answers, so the hold is the chip's: `remove` starts the exit, during which
 * the thing is `leaving` (drawn as its exit, and `inert`, since it already
 * reads as gone), and the caller's `onRemove` is asked once the motions the
 * element handed `ref` runs have finished (`useDisclosure`). A caller that
 * keeps it after all, a lift refused, finds it standing again. Reduced
 * motion and a capture run zero the exit, and a DOM that runs no motion, a
 * test's, asks at once.
 */

export interface Removal {
  /** Whether its × was pressed and it is on its way out, its exit to be drawn. */
  readonly leaving: boolean;
  /** The ref for the element whose exit the removal waits on. */
  readonly ref: (element: HTMLElement | null) => void;
  /** Starts its exit, asking the caller's `onRemove` once it is done. */
  readonly remove: () => void;
}

export function useRemoval(onRemove: (() => void) | undefined): Removal {
  const [removing, setRemoving] = useState(false);
  const { mounted, ref } = useDisclosure(!removing);
  // Note that the caller's latest `onRemove` is asked, because one handed
  // over before the exit may name a place in a list that has since moved.
  const latest = useRef(onRemove);
  latest.current = onRemove;

  useLayoutEffect(() => {
    if (mounted) return;
    setRemoving(false);
    latest.current?.();
  }, [mounted]);

  return { leaving: removing, ref, remove: () => setRemoving(true) };
}
