/**
 * frames.ts -- the window's animation frames as a test lets them pass, so work held until a frame has painted (`after-paint.ts`) runs where the test says.
 *
 * A test's DOM runs its frames on a real timer, which a test never waits on.
 * `holdFrames` holds every frame asked for instead, and `passFrames` lets
 * them pass, with the frames they ask for in turn, as a paint and the frame
 * after it would. Without `holdFrames`, `passFrames` lets nothing pass, so a
 * settle that calls it (`settleFrames`) serves a test that holds no frames as
 * well.
 */

import { act } from "react";
import { vi } from "vitest";

/** The frames asked for and not yet passed, by the id each was asked under. */
const held = new Map<number, FrameRequestCallback>();
let asked = 0;

/** Holds the window's animation frames until `passFrames` lets them pass; `vi.restoreAllMocks()` gives the real ones back. */
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

/** Lets the frames held so far pass, then the ones those asked for: the frame a paint belongs to and the one after it; answers whether any was held. */
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

/**
 * Lets every promise settled so far run its continuations, then the frames
 * held pass (`passFrames`), round after round until no frame is held, ten
 * rounds at most. Note that each round is an `act` of its own, because the
 * effects `act` runs as it ends may ask for frames too.
 */
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
