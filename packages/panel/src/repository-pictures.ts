import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * repository-pictures.ts -- whether a surface outside the Tasks tab draws a repository by its owner's picture.
 *
 * The Tasks tab says it on its own door (`tasks.repositories.pictures`); a
 * surface that reads no tab, a Settings page, asks the window's run instead.
 * A fixture run draws none, because its frames ask nothing of the network.
 */
export function useRepositoryPictures(): boolean {
  return useAppSlice(APP_SLICE.RUN)?.fixtureMode !== true;
}
