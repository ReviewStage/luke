import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** White-space values that hold words to one line, whose box is cut only past its end. */
const ONE_LINE_WHITE_SPACE = new Set(["nowrap", "pre"]);

/**
 * Whether the box's words run past it: past its end on one line, or below
 * its last line where they wrap and are held to a few. Note that a line held
 * to one is never cut below, because a face's glyphs may stand a pixel or two
 * past a tight leading (a 16px name on an 18px line), which cuts no word.
 */
function cutShort(element: HTMLElement): boolean {
  if (element.scrollWidth > element.clientWidth) return true;
  if (ONE_LINE_WHITE_SPACE.has(getComputedStyle(element).whiteSpace)) return false;
  return element.scrollHeight > element.clientHeight;
}

/**
 * use-clipped.ts -- whether a line of words is cut short by its box, or words held to a few lines are cut below the last, for the labels that fade out at their end rather than end in an ellipsis.
 *
 * The element the ref is handed is measured whenever its box resizes, the
 * room around it given to something else, and whenever its words change,
 * since a box whose width its row sets keeps that width when its words are
 * renamed longer or shorter. The owner marks it `data-overflow`, which its
 * stylesheet fades out over its last few pixels
 * (`--luke-label-fade`), as Chrome's and Arc's tabs end a long title.
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
      // Note that a host with no observer (a server render, a test's DOM)
      // lays nothing out either, so its line is never cut short.
      if (typeof ResizeObserver === "undefined") {
        return () => {
          box.current = null;
        };
      }
      const measure = () => setClipped(cutShort(element));
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
    setClipped(cutShort(element));
  }, [words]);
  return [measured, clipped];
}
