import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * use-disclosure.ts -- keeps something that closes drawn through its exit, and takes it out once the exit is done.
 *
 * docs/DESIGN.md has content leaving go first and an element that unmounts
 * held mounted through its own exit, taken out when the exit finishes rather
 * than on the frame the state changed. This is that hold, for anything whose
 * open state is someone else's: a fold, a menu, a card. While `open` it is
 * `mounted`; once `open` turns false it stays `mounted` and is `leaving`,
 * which the caller draws as its exit (a fade over `--duration-exit`, say)
 * and makes `inert`, since it already reads as closed, and it is taken out once the motions the element handed `ref` runs have
 * finished. Opening again while it leaves keeps it, and the exit cut short
 * takes nothing away. Reduced motion and a capture run zero the tokens an
 * exit is timed on, and an element that runs no motion is taken out at once.
 *
 * The motion itself is the stylesheet's. Carried here from #2311, less the
 * fold layer it draws, until that PR lands and this file becomes its own.
 */

export interface Disclosure {
  /** Whether to draw it: open, or closed and still leaving. */
  readonly mounted: boolean;
  /** Whether it is closed and on its way out, its exit to be drawn. */
  readonly leaving: boolean;
  /** The ref for the element whose motions the hold waits on. */
  readonly ref: (element: HTMLElement | null) => void;
}

/** The motions an element runs. Note that a DOM with no animation engine, a test's, runs none. */
function running(element: HTMLElement): Animation[] {
  return "getAnimations" in element ? element.getAnimations() : [];
}

export function useDisclosure(open: boolean): Disclosure {
  const [was, setWas] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const held = useRef<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    held.current = element;
  }, []);
  // Note that the change is taken in the render that sees it, because a
  // close noticed an effect later would draw one frame with nothing there.
  if (open !== was) {
    setWas(open);
    setLeaving(!open);
  }

  useLayoutEffect(() => {
    if (!leaving) return undefined;
    const exits = held.current === null ? [] : running(held.current);
    if (exits.length === 0) {
      setLeaving(false);
      return undefined;
    }
    // Note that an exit cancelled counts as done, since nothing is left to
    // wait for; an open again cancels it too, but leaves this effect behind
    // first, which `current` answers.
    let current = true;
    const left = new Set(exits);
    for (const exit of exits) {
      const ended = () => {
        left.delete(exit);
        if (current && left.size === 0) setLeaving(false);
      };
      exit.addEventListener("finish", ended, { once: true });
      exit.addEventListener("cancel", ended, { once: true });
    }
    return () => {
      current = false;
    };
  }, [leaving]);

  return { mounted: open || leaving, leaving, ref };
}
