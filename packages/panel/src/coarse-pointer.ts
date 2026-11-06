import { useEffect, useState } from "react";

export const COARSE_POINTER = "(pointer: coarse)";

export const FINGER_SELECTION_GAP = 16;

export function coarsePointerNow(): boolean {
  return window.matchMedia(COARSE_POINTER).matches;
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(coarsePointerNow);
  useEffect(() => {
    const query = window.matchMedia(COARSE_POINTER);
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}
