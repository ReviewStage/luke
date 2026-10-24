import { type RefObject, useEffect, useRef } from "react";

/**
 * press-away.ts -- a press outside a hung layer, heard once for every popover: the one place a press anywhere else in the window is listened for.
 *
 * A popover hung from a button (`anchored-popover.tsx`) or standing by a
 * caret or a box (`../rect-float/rect-float.tsx`) closes, as a menu does,
 * on a press outside it, which its owner hears as `onPressAway`. A press
 * inside the layer is its own; a press on the box it hangs from (the
 * button that opened it, whose own press is what closes it) or on what
 * its owner `holds` (the field whose caret it stands by, or a question it
 * asked) is its owner's, and is left to them. Note that the press is heard
 * as it is captured, before whatever it lands on answers it, because a
 * control that keeps the focus or stops the press would otherwise hide it.
 */

/** What a layer's press away hears: the press, and what its owner keeps as its own though outside the layer. */
export interface PressAway {
  /** A press outside the layer and outside what its owner holds; none hears no press away. */
  readonly onPressAway?: (() => void) | undefined;
  /** Whether a press on `target`, outside the layer, is still its owner's. */
  readonly holds?: ((target: Node) => boolean) | undefined;
}

/**
 * Hears a press outside `layer` and outside the box it hangs from
 * (`anchor`), while `onPressAway` is handed. Note that the owner's latest
 * handlers are read as the press lands, so a draw that hands new ones
 * listens again for nothing.
 */
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
