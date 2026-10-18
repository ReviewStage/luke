import { useCallback, useState } from "react";

/**
 * use-clipped.ts -- whether a line of words is cut short by its box, for the labels that fade out at their end rather than end in an ellipsis.
 *
 * The element the ref is handed is measured whenever its box resizes, the
 * room around it given to something else, and whenever its words change,
 * since a box whose width its row sets keeps that width when its words are
 * renamed longer or shorter. The owner marks it `data-overflow`, which its
 * stylesheet fades out over its last few pixels (the desktop's
 * `--label-fade`), as Chrome's and Arc's tabs end a long title.
 */
export function useClipped(): [(element: HTMLElement | null) => (() => void) | undefined, boolean] {
  const [clipped, setClipped] = useState(false);
  const measured = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const measure = () => setClipped(element.scrollWidth > element.clientWidth);
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    const reworded = new MutationObserver(measure);
    reworded.observe(element, { characterData: true, childList: true, subtree: true });
    return () => {
      resized.disconnect();
      reworded.disconnect();
    };
  }, []);
  return [measured, clipped];
}
