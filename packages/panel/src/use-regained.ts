/**
 * use-regained.ts -- a callback run each time the app reaches the service again, so a read a surface asked once, and that failed while the connection was gone, asks again by itself.
 *
 * The host asks every read it holds again as the connection comes back
 * (`TASKS_REGAINED`); a read a surface asked itself, as a pull request's
 * files or a description's older version are, is the surface's to ask again, which
 * it does here, where its last ask failed and it is still shown.
 */

import { networkConnected } from "@repo/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useRef } from "react";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/** Whether the app reaches the service, as the document's `network` slice says; reaching it before the first snapshot lands. */
const CONNECTED: Atom.Atom<boolean> = Atom.map(
  APP_SLICE.NETWORK,
  (network) => network === undefined || networkConnected(network),
);

/** Runs `regained` each time the app reaches the service again after it did not, never as the surface first draws. */
export function useRegained(regained: () => void): void {
  const connected = useAppSlice(CONNECTED);
  const latest = useRef(regained);
  latest.current = regained;
  const was = useRef(connected);
  useEffect(() => {
    const before = was.current;
    was.current = connected;
    if (connected && !before) latest.current();
  }, [connected]);
}
