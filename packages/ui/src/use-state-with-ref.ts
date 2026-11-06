import { useCallback, useRef, useState } from "react";

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
