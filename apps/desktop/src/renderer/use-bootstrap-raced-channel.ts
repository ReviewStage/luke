import { useCallback, useEffect, useRef } from "react";

/**
 * Whether a bootstrap snapshot is still the newest word. A live push that
 * arrived while the reply was in flight is newer, and the main process will
 * not repeat a list it believes it already announced.
 */
export function staleBootstrap(pushed: boolean): boolean {
  return pushed;
}

/**
 * A channel whose live pushes beat a bootstrap snapshot still in flight.
 * Subscribe once; apply a bootstrap value only if nothing newer has landed.
 */
export function useBootstrapRacedChannel<T>(
  subscribe: (onChange: (value: T) => void) => () => void,
  apply: (value: T) => void,
): (bootstrapValue: T) => void {
  const pushed = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(
    () =>
      subscribeRef.current((value) => {
        pushed.current = true;
        applyRef.current(value);
      }),
    [],
  );

  return useCallback((bootstrapValue: T) => {
    if (staleBootstrap(pushed.current)) return;
    applyRef.current(bootstrapValue);
  }, []);
}
