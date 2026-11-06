import { useCallback, useLayoutEffect, useRef, useState } from "react";

const ONE_LINE_WHITE_SPACE = new Set(["nowrap", "pre"]);

function cutShort(element: HTMLElement): boolean {
  if (element.scrollWidth > element.clientWidth) return true;
  if (ONE_LINE_WHITE_SPACE.has(getComputedStyle(element).whiteSpace)) return false;
  return element.scrollHeight > element.clientHeight;
}

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
