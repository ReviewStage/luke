import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * use-clipped.ts -- whether a line of words is cut short by its box, for the labels that fade out at their end rather than end in an ellipsis.
 *
 * The element the ref is handed is measured whenever its box resizes, the
 * room around it given to something else, and whenever its words change,
 * since a box whose width its row sets keeps that width when its words are
 * renamed longer or shorter. The owner marks it `data-overflow`, which its
 * stylesheet fades out over its last few pixels (the desktop's
 * `--label-fade`), as Chrome's and Arc's tabs end a long title.
 *
 * An owner that draws its words from a string hands it as `words`, and the
 * box is measured in the render that changes it, before it is painted.
 * Note that one handing none is watched for any change under the box, at
 * the cost of a subtree observer and a measure on every change it hears,
 * because its words are a tree the hook cannot compare.
 */
export function useClipped(
  words?: string,
): [(element: HTMLElement | null) => (() => void) | undefined, boolean] {
  const [clipped, setClipped] = useState(false);
  const box = useRef<HTMLElement | null>(null);
  const keyed = words !== undefined;
  const measured = useCallback(
    (element: HTMLElement | null) => {
      if (element === null) return undefined;
      box.current = element;
      const measure = () => setClipped(element.scrollWidth > element.clientWidth);
      const resized = new ResizeObserver(measure);
      resized.observe(element);
      const reworded = keyed ? undefined : new MutationObserver(measure);
      reworded?.observe(element, { characterData: true, childList: true, subtree: true });
      return () => {
        box.current = null;
        resized.disconnect();
        reworded?.disconnect();
      };
    },
    [keyed],
  );
  // The words a render drew are measured once they change; the observer's
  // first report measures the box it is handed, so the first words are its.
  const drawn = useRef(words);
  useLayoutEffect(() => {
    if (words === drawn.current) return;
    drawn.current = words;
    const element = box.current;
    if (element === null || words === undefined) return;
    setClipped(element.scrollWidth > element.clientWidth);
  }, [words]);
  return [measured, clipped];
}
