import { useEffect, useState } from "react";
import { motionHeld } from "./motion-timing.js";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function useMotionHeld(): boolean {
  const [held, setHeld] = useState(() => typeof document === "undefined" || motionHeld());

  useEffect(() => {
    const update = () => setHeld(motionHeld());
    update();
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return held;
}
