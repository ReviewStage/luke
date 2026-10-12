/**
 * spinner.ts -- what a test of a wait reads: each spinner's words as a reader hears them, and whether its ring is drawn.
 *
 * A spinner shows only once its wait has stood a moment on the renderer's
 * clock, so a test that reads one mounts on `registryOnTestClock`
 * (`copy-feedback.ts`) and adjusts `TestClock` past that moment first.
 */

import { Duration } from "effect";

/** Long enough past any spinner's own delay that a wait standing this long shows. */
export const PAST_SPINNER_DELAY = Duration.millis(400);

/** A wait as a reader and an eye meet it: the words it says, and whether its ring turns. */
export interface WaitSeen {
  readonly says: string;
  readonly ring: boolean;
}

/** Every wait standing in `container`, in order: a status line and the ring inside it. */
export function waitsIn(container: ParentNode): WaitSeen[] {
  return [...container.querySelectorAll('[role="status"]')].map((status) => ({
    says: status.textContent ?? "",
    ring: status.querySelector(".spinner-ring") !== null,
  }));
}
