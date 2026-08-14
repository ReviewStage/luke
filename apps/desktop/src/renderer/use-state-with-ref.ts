import { useCallback, useRef, useState } from "react";

/**
 * Keep a ref in lockstep with the value a setter is about to publish, so a
 * callback can read it before the next render. A close decided inside a timer
 * has to see the field that was just opened, not the shape last drawn.
 */
export function shadowRef<T>(ref: { current: T }, next: T): T {
  ref.current = next;
  return next;
}

/**
 * State whose latest value is needed from a callback that cannot wait a
 * render. The setter writes a ref in the same turn; `latest` reads it.
 */
export function useStateWithRef<T>(initial: T): [T, (next: T) => void, () => T] {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    setState(shadowRef(ref, next));
  }, []);
  const latest = useCallback(() => ref.current, []);
  return [state, set, latest];
}
