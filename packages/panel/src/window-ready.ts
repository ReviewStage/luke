/**
 * window-ready.ts -- the report that the window has painted, which main waits on before it takes a capture.
 */

import { useEffect, useRef } from "react";
import { appBridge } from "./app-bridge.js";

/**
 * Reports the window painted, once, the first time `ready` stands. The app
 * says it ready when its settings have arrived and, for a fixture run, when
 * the synthetic tasks it imports on demand have settled, because a capture
 * is taken a moment after this report.
 */
export function useWindowReady(ready: boolean): void {
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || !ready) return;
    reported.current = true;
    appBridge().notifyReady();
  }, [ready]);
}
