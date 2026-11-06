import { act } from "react";
import { onTestFinished, vi } from "vitest";

const HELD_MS = 2000;

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
