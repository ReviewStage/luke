/**
 * finger.ts -- a test's finger on a touch screen: the window answering `(pointer: coarse)`, and a touch held still past a long press.
 *
 * jsdom answers no media query (`match-media.ts`), so a test of what a
 * finger's surface draws stubs the one query `useCoarsePointer` asks, until
 * `vi.restoreAllMocks()`. A long press is a touch that goes down and stays
 * still past the menu's hold (`@luke/ui`'s `touch-hold.ts`), on fake timers
 * held only for as long as it is down.
 */

import { act } from "react";
import { vi } from "vitest";
import { COARSE_POINTER } from "../coarse-pointer.js";

/** A finger's touch of `type` at the target's corner, as the browser sends it. */
function touch(type: string): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });
}

/** Has the window answer that its main pointer is a finger, and no other query. */
export function underAFinger(): void {
  const ignore = () => undefined;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === COARSE_POINTER,
    media: query,
    onchange: null,
    addEventListener: ignore,
    removeEventListener: ignore,
    addListener: ignore,
    removeListener: ignore,
    dispatchEvent: () => false,
  }));
}

/** A finger held still on `target` well past a long press, then lifted. */
export function longPress(target: HTMLElement): void {
  vi.useFakeTimers();
  try {
    act(() => {
      target.dispatchEvent(touch("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  } finally {
    vi.useRealTimers();
  }
  act(() => {
    target.dispatchEvent(touch("pointerup"));
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true }));
  });
}
