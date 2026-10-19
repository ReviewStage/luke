/**
 * stage-width.ts -- how wide the panel's stage stands, measured as it resizes, for the layout that follows the room the panel has rather than the window's.
 *
 * The stage is the shell's root element, the one the panel draws everything
 * in. On the desktop it fills the window, so its width is the window's; in a
 * browser tab, or in a test, it is whatever box the page gives the panel. The
 * shell measures it once, at its root, and hands the width to each layout
 * that folds or rearranges by it.
 */

import { useCallback, useState } from "react";

/** What the stage is measured by. */
export interface StageWidth {
  /** The stage's own element, whose width is measured. */
  readonly ref: React.RefCallback<HTMLElement>;
  /** The stage's width in CSS pixels, or `undefined` until a stage laid out has measured. */
  readonly width: number | undefined;
}

/**
 * The stage's width, measured as it resizes. A stage that measures nothing,
 * as one not yet laid out, keeps the width it last had. Note that the first
 * measure lands while the stage is committed, before the window paints, so
 * nothing laid out by it is ever drawn at the wrong width first.
 */
export function useStageWidth(): StageWidth {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
