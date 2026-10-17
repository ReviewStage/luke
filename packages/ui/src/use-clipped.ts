import { useCallback, useState } from "react";

/**
 * use-clipped.ts -- whether a line of words is cut short by its box, for the labels that fade out at their end rather than end in an ellipsis.
 *
 * The element the ref is handed is measured whenever its box resizes: words
 * renamed, or the room around them given to something else. The owner marks
 * it `data-overflow`, which its stylesheet fades out over its last few
 * pixels (the desktop's `--label-fade`), as Chrome's and Arc's tabs end a
 * long title.
 */
export function useClipped(): [(element: HTMLElement | null) => (() => void) | undefined, boolean] {
  const [clipped, setClipped] = useState(false);
  const measured = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const observer = new ResizeObserver(() =>
      setClipped(element.scrollWidth > element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [measured, clipped];
}
