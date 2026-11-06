/**
 * use-regained.ts -- a callback run each time the app reaches the service again, so a read a surface asked once, and that failed while the connection was gone, asks again by itself.
 *
 * The host asks every read it holds again as the connection comes back
 * (`TASKS_REGAINED`); a read a surface asked itself, as a pull request's
 * files or a plan's older version are, is the surface's to ask again, which
 * it does here, where its last ask failed and it is still shown.
 */

import { useEffect, useRef } from "react";
import { useConnected } from "./connection.js";

/** Runs `regained` each time the app reaches the service again after it did not, never as the surface first draws. */
export function useRegained(regained: () => void): void {
  const connected = useConnected();
  const latest = useRef(regained);
  latest.current = regained;
  const was = useRef(connected);
  useEffect(() => {
    const before = was.current;
    was.current = connected;
    if (connected && !before) latest.current();
  }, [connected]);
}
