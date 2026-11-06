import { type RefObject, useEffect } from "react";

export function useHeldFocus<Element extends HTMLElement>(
  target: RefObject<Element | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (active) target.current?.focus({ preventScroll: true });
  }, [active, target]);
}
