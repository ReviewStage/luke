import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@repo/brand";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useMemo, useState } from "react";
import { milliseconds } from "../../motion-timing.js";

const SETTLE_DELAY_TOKEN = "--ui-settle-delay";

function settleDelay(): number {
  const value = getComputedStyle(document.body).getPropertyValue(SETTLE_DELAY_TOKEN);
  return value.trim() === "" ? MOTION_DELAY_MS.SETTLE : milliseconds(value);
}

function settleWait() {
  return Atom.fn(({ delay, settle }: { readonly delay: number; readonly settle: () => void }) =>
    Effect.andThen(Effect.sleep(Duration.millis(delay)), Effect.sync(settle)),
  );
}

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
