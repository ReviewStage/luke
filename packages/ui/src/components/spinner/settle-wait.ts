/**
 * settle-wait.ts -- the one wait a ring stands out before it shows, so a wait that lands at once never flashes one.
 *
 * Every ring a wait draws, a Spinner's, a busy control's, a busy button's,
 * shows only once its wait has stood `--ui-settle-delay` (180ms), read as
 * it stands on the window, so a capture run, which zeroes it, shows the ring
 * at once. Each wait begun waits afresh, and one that ends before the delay
 * has shown nothing. The wait forks on the library's edge, as a hint's rest
 * does (`../tooltip/hint.tsx`, `../../wait.ts`), so nothing here arms a
 * timer of its own and a test moves it on a faked clock.
 */

import { MOTION_DELAY_MS } from "@repo/brand";
import { Duration, Effect } from "effect";
import { useEffect, useState } from "react";
import { milliseconds } from "../../motion-timing.js";
import { useWait } from "../../wait.js";

/** The token the wait stands out, which a capture run zeroes. */
const SETTLE_DELAY_TOKEN = "--ui-settle-delay";

/**
 * How long a wait stands before its ring shows, read where a capture run
 * sets it. Note that a window no stylesheet has drawn sets nothing, and
 * waits the brand's own delay, the one the token is generated from.
 */
function settleDelay(): number {
  const value = getComputedStyle(document.body).getPropertyValue(SETTLE_DELAY_TOKEN);
  return value.trim() === "" ? MOTION_DELAY_MS.SETTLE : milliseconds(value);
}

/** Whether a wait under way (`waiting`) has stood the settle delay, so its ring shows; never while nothing waits. */
export function useSettled(waiting: boolean): boolean {
  const wait = useWait();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!waiting) return undefined;
    const delay = settleDelay();
    if (delay <= 0) {
      setSettled(true);
      return undefined;
    }
    wait.start(
      Effect.andThen(
        Effect.sleep(Duration.millis(delay)),
        Effect.sync(() => setSettled(true)),
      ),
    );
    return wait.stop;
  }, [waiting, wait]);
  return waiting && settled;
}
