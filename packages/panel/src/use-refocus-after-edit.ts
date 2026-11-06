import { type RefObject, useCallback, useEffect, useRef } from "react";

export function useRefocusAfterEdit(
  open: boolean,
  target: RefObject<HTMLElement | null>,
): (byKey: boolean) => void {
  const refocus = useRef(false);
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    target.current?.focus();
  }, [open, target]);
  return useCallback((byKey: boolean) => {
    refocus.current = byKey;
  }, []);
}
