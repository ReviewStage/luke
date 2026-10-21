/**
 * hint-rest.ts -- the pointer or the keyboard resting on a control past the window's hint wait (`tooltip.tsx`'s `useHintRest`), on a faked clock, so a test reads the pill or card it hangs.
 *
 * A hint is mounted only once its control has been rested on, so a test
 * that reads one arrives on the control and lets the wait run out on the
 * faked clock rather than the real one. A test already on a faked clock
 * keeps it; one that is not is put back on the real clock once the wait has
 * run.
 */

import { MOTION_DELAY_MS } from "@luke/brand";
import { act } from "react";
import { vi } from "vitest";

/** `arrive` on a control, then the hint's wait run out. */
function rested(arrive: () => void): void {
  const faked = vi.isFakeTimers();
  if (!faked) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(arrive);
    act(() => {
      vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
    });
  } finally {
    if (!faked) vi.useRealTimers();
  }
}

/** The pointer arriving on `target` and resting there past the hint's wait. */
export function restOn(target: Element, init: MouseEventInit = {}): void {
  rested(() => {
    target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, ...init }));
  });
}

/** The focus arriving on `target` and resting there past the hint's wait; a hint that shows only for the keyboard's focus asks the caller to mark the window's keyboard first. */
export function focusRestOn(target: HTMLElement): void {
  rested(() => target.focus());
}
