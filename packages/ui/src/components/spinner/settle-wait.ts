/**
 * settle-wait.ts -- the one wait a ring stands out before it shows, so a wait that lands at once never flashes one.
 *
 * Every ring a wait draws, a Spinner's, a busy control's, a busy button's,
 * shows only once its wait has stood `--luke-settle-delay` (180ms), read as
 * it stands on the window, so a capture run, which zeroes it, shows the ring
 * at once. Each wait begun waits afresh, and one that ends before the delay
 * has shown nothing. The wait is an atom's work on the registry the app's
 * root provides, or the library's own where none is, as a hint's rest is
 * (`../tooltip/hint.tsx`), so nothing here arms a timer of its own and a
 * test moves it on a faked clock.
 */

import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@luke/brand";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useMemo, useState } from "react";
import { milliseconds } from "../../motion-timing.js";

/** The token the wait stands out, which a capture run zeroes. */
const SETTLE_DELAY_TOKEN = "--luke-settle-delay";

/**
 * How long a wait stands before its ring shows, read where a capture run
 * sets it. Note that a window no stylesheet has drawn sets nothing, and
 * waits the brand's own delay, the one the token is generated from.
 */
function settleDelay(): number {
  const value = getComputedStyle(document.body).getPropertyValue(SETTLE_DELAY_TOKEN);
  return value.trim() === "" ? MOTION_DELAY_MS.SETTLE : milliseconds(value);
}

/**
 * One wait's settling, as an atom whose work is the wait: it says the wait
 * has settled once the delay has run out. Each mounted wait makes its own,
 * held for as long as it is mounted; a new wait starts it afresh and an
 * interrupt calls it off. Note that the way to say so is handed inside a
 * record, because a function handed to an atom's setter is read as an update
 * of its value and called at once.
 */
function settleWait() {
  return Atom.fn(({ delay, settle }: { readonly delay: number; readonly settle: () => void }) =>
    Effect.andThen(Effect.sleep(Duration.millis(delay)), Effect.sync(settle)),
  );
}

/** Whether a wait under way (`waiting`) has stood the settle delay, so its ring shows; never while nothing waits. */
export function useSettled(waiting: boolean): boolean {
  const atom = useMemo(settleWait, []);
  const wait = useAtomSet(atom);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!waiting) return undefined;
    const delay = settleDelay();
    if (delay <= 0) {
      setSettled(true);
      return undefined;
    }
    wait({ delay, settle: () => setSettled(true) });
    return () => wait(Atom.Interrupt);
  }, [waiting, wait]);
  return waiting && settled;
}
