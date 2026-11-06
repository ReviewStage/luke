import { useQuery } from "@tanstack/react-query";
import { appStateQuery, selectRun } from "./use-app-state.js";

/**
 * repository-pictures.ts -- whether a surface outside the Tasks tab draws a repository by its owner's picture.
 *
 * The Tasks tab says it on its own door (`tasks.repositories.pictures`); a
 * surface that reads no tab, a Settings page, asks the window's run instead.
 * A fixture run draws none, because its frames ask nothing of the network.
 */
export function useRepositoryPictures(): boolean {
  return useQuery({ ...appStateQuery, select: selectRun }).data?.fixtureMode !== true;
}
