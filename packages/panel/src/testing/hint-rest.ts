import { MOTION_DELAY_MS } from "@repo/brand";
import { act } from "react";
import { vi } from "vitest";

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

export function restOn(target: Element, init: MouseEventInit = {}): void {
  rested(() => {
    target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, ...init }));
  });
}

export function focusRestOn(target: HTMLElement): void {
  rested(() => target.focus());
}
