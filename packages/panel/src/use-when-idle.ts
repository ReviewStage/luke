import { useEffect, useRef } from "react";

/**
 * use-when-idle.ts -- work the panel's first paint does not need, started once the renderer has nothing better to do.
 *
 * The first commit competes with whatever it starts: parsing the editor
 * bundle, the markdown parser, or the session recorder is main-thread time the
 * first interactions then wait behind. `useWhenIdle` holds such work back until
 * `requestIdleCallback` reports an idle moment, and no longer than `timeoutMs`
 * on a renderer that never goes idle, so it still happens.
 */

/** How long an idle callback may be held back before it runs regardless. */
export const IDLE_TIMEOUT_MS = {
  /** Session replay is how the team sees problems, so it starts within a few seconds on any renderer. */
  SESSION_REPLAY: 3000,
  /** Warming the editor and the markdown parser is a courtesy to a later click, so it yields to replay. */
  PREFETCH: 5000,
} as const;

/**
 * Calls `work` once, when the renderer is next idle or `timeoutMs` has passed,
 * whichever comes first; the call is cancelled where the component leaves
 * first. A new `work` before then replaces the old one without restarting the wait.
 *
 * A browser with no `requestIdleCallback` (Safari) runs it after the next
 * frame has painted, the nearest thing it has to the first paint being done.
 */
export function useWhenIdle(work: () => void, timeoutMs: number): void {
  const latest = useRef(work);
  useEffect(() => {
    latest.current = work;
  }, [work]);
  useEffect(() => {
    const run = () => latest.current();
    if ("requestIdleCallback" in globalThis) {
      const handle = globalThis.requestIdleCallback(run, { timeout: timeoutMs });
      return () => globalThis.cancelIdleCallback(handle);
    }
    const frame = globalThis.requestAnimationFrame(run);
    return () => globalThis.cancelAnimationFrame(frame);
  }, [timeoutMs]);
}
