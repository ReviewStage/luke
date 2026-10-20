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
 * A browser with no `requestIdleCallback` (Safari) runs it after the first
 * frame has painted, or at once in a hidden tab, which paints none.
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
    let cancelled = false;
    const go = () => {
      if (!cancelled) run();
    };
    // A hidden tab paints no frames, so waiting for one would hold the work until it is looked at; nobody is waiting on that tab's first paint, so it runs at once.
    if (document.visibilityState === "hidden") {
      queueMicrotask(go);
      return () => {
        cancelled = true;
      };
    }
    // Two frames on: the first runs before the paint it belongs to, the second after it.
    let frame = globalThis.requestAnimationFrame(() => {
      frame = globalThis.requestAnimationFrame(go);
    });
    return () => {
      cancelled = true;
      globalThis.cancelAnimationFrame(frame);
    };
  }, [timeoutMs]);
}
