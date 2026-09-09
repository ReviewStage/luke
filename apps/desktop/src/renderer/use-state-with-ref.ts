import { useCallback, useRef, useState } from "react";

/**
 * State whose latest value is needed from a callback that cannot wait a
 * render. The setter writes a ref in the same turn; `latest` reads it, so a
 * close decided inside a timer sees the field that was just opened rather
 * than the shape last drawn.
 */
export function useStateWithRef<T>(initial: T): [T, (next: T) => void, () => T] {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setState(next);
  }, []);
  const latest = useCallback(() => ref.current, []);
  return [state, set, latest];
}
