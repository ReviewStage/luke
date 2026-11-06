/**
 * connection.ts -- whether this window reaches the service now, the one reading a surface goes quiet by while it does not.
 *
 * It is `@repo/host`'s `networkConnected` over the document's `network`
 * slice, which the Offline mark reads too, so every surface that holds its
 * failures back while the app is offline goes by the same answer the mark
 * says. It is taken as connected until the document is read.
 */

import { type AppStateSnapshot, networkConnected } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "./use-app-state.js";

/** Whether the window reaches the service, which redraws its readers only as it turns. */
const selectConnected = (state: AppStateSnapshot): boolean => networkConnected(state.network);

/** Whether the window reaches the service now. */
export function useConnected(): boolean {
  return useQuery({ ...appStateQuery, select: selectConnected }).data ?? true;
}
