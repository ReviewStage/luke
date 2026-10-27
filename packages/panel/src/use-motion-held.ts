import { motionHeld } from "@luke/ui";
import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether motion is held still, for what a script plays that the stylesheet
 * cannot hold: holding every loop still leaves the poses, and switching
 * between poses is the motion someone asked not to see. Note that the tokens
 * are what answers; the setting's media query only says when to read them
 * again, since the tokens change with it.
 */
export function useMotionHeld(): boolean {
  const [held, setHeld] = useState(() => motionHeld());

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setHeld(motionHeld());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return held;
}
