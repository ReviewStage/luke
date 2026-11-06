import { type AppStateSnapshot, networkConnected } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "./use-app-state.js";

const selectConnected = (state: AppStateSnapshot): boolean => networkConnected(state.network);

export function useConnected(): boolean {
  return useQuery({ ...appStateQuery, select: selectConnected }).data ?? true;
}
