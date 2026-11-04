import { useEffect, useState } from "react";
import { motionHeld } from "./motion-timing.js";

/**
 * use-motion-held.ts -- whether motion is held still, read again as the reduced-motion setting changes.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether motion is held still, for what a script plays that the stylesheet
 * cannot hold: holding every loop still leaves the poses, and switching
 * between poses is the motion someone asked not to see. Note that the tokens
 * are what answers; the setting's media query only says when to read them
 * again, since the tokens change with it.
 */
export function useMotionHeld(): boolean {
  // Note that a render off a page, as a static render is, has no tokens to read, and holds still.
  const [held, setHeld] = useState(() => typeof document === "undefined" || motionHeld());

  useEffect(() => {
    const update = () => setHeld(motionHeld());
    // Note that we read again once drawn, because a capture run zeroes the tokens under a stage
    // that may be committed beside the caller, after the render's own read.
    update();
    // Note that a document with no media queries, as a test's is, has no setting to follow.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return held;
}
