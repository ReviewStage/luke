import { useQuery } from "@tanstack/react-query";
import { appStateQuery, selectRun } from "./use-app-state.js";

export function useRepositoryPictures(): boolean {
  return useQuery({ ...appStateQuery, select: selectRun }).data?.fixtureMode !== true;
}
