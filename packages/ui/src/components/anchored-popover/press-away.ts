import { type RefObject, useEffect, useRef } from "react";

export interface PressAway {
  readonly onPressAway?: (() => void) | undefined;
  readonly holds?: ((target: Node) => boolean) | undefined;
}

export function usePressAway(
  layer: RefObject<HTMLElement | null>,
  anchor: () => Element | null | undefined,
  { onPressAway, holds }: PressAway,
): void {
  const latest = useRef({ anchor, onPressAway, holds });
  latest.current = { anchor, onPressAway, holds };
  const hearing = onPressAway !== undefined;
  useEffect(() => {
    if (!hearing) return undefined;
    const pressed = (event: PointerEvent) => {
      const { target } = event;
      if (!(target instanceof Node)) return;
      const own = latest.current;
      if (layer.current?.contains(target) === true) return;
      if (own.anchor()?.contains(target) === true) return;
      if (own.holds?.(target) === true) return;
      own.onPressAway?.();
    };
    document.addEventListener("pointerdown", pressed, true);
    return () => document.removeEventListener("pointerdown", pressed, true);
  }, [hearing, layer]);
}
