/**
 * finger.ts -- a window worked by a finger: its pointer answering `(pointer: coarse)`, and a long press held on a row as the browser sends it.
 *
 * A finger's window is stubbed for the one test that asks for it and put
 * back as that test finishes, so a file's other tests keep the mouse the
 * suite's setup answers (`match-media.ts`). The long press is held on a
 * faked clock well past `ListRow`'s hold, then lifted, and the test is put
 * back on the real clock.
 */

import { act } from "react";
import { onTestFinished, vi } from "vitest";

/** How long the finger is held, well past any row's long press. */
const HELD_MS = 2000;

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

/** The window answers that its main pointer is a finger until the test finishes. */
export function underAFinger(): void {
  const stub = vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query === "(pointer: coarse)",
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
  onTestFinished(() => stub.mockRestore());
}

/** A finger held still on `target` well past a long press, then lifted. */
export function longPress(target: HTMLElement): void {
  vi.useFakeTimers();
  try {
    act(() => {
      target.dispatchEvent(touch("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(HELD_MS);
    });
  } finally {
    vi.useRealTimers();
  }
  act(() => {
    target.dispatchEvent(touch("pointerup"));
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true }));
  });
}
