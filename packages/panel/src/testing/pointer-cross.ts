/**
 * pointer-cross.ts -- the pointer crossing from one element onto another, as React hears a leave and an enter.
 */

import { act } from "react";

/** The pointer crossing from `from` onto `to`, as React hears a leave and an enter. */
export function pointerCross(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}
