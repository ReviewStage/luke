import { useEffect, useRef } from "react";
import { afterPaint } from "./after-paint.js";

export const IDLE_TIMEOUT_MS = {
  SESSION_REPLAY: 3000,
  PREFETCH: 5000,
} as const;

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
    return afterPaint(run);
  }, [timeoutMs]);
}
