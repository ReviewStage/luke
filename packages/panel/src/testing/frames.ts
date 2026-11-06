import { act } from "react";
import { vi } from "vitest";

const held = new Map<number, FrameRequestCallback>();
let asked = 0;

export function holdFrames(): void {
  held.clear();
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((frame) => {
    asked += 1;
    held.set(asked, frame);
    return asked;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    held.delete(id);
  });
}

function passFrames(): boolean {
  let passed = false;
  for (let frame = 0; frame < 2; frame += 1) {
    const due = [...held.values()];
    held.clear();
    for (const run of due) run(performance.now());
    passed ||= due.length > 0;
  }
  return passed;
}

export async function settleFrames(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
    });
    let passed = false;
    act(() => {
      passed = passFrames();
    });
    if (!passed) return;
  }
}
