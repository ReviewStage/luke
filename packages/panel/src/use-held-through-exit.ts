import { useCallback, useState } from "react";

interface HeldThroughExit<T> {
  held: T | undefined;
  onExited: () => void;
}

export function useHeldThroughExit<T>(shown: T | undefined): HeldThroughExit<T> {
  const [last, setLast] = useState(shown);
  if (shown !== undefined && last !== shown) setLast(shown);
  const onExited = useCallback(() => setLast(undefined), []);
  return { held: shown ?? last, onExited };
}

export function useDrawnThroughExit(open: boolean): { drawn: boolean; onExited: () => void } {
  const { held, onExited } = useHeldThroughExit(open ? true : undefined);
  return { drawn: held !== undefined, onExited };
}
