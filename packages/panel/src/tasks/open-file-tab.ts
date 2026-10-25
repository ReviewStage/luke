import { createContext, useContext } from "react";

/**
 * open-file-tab.ts -- the side panel's door to a File tab, for a file chosen with ⌘ or Ctrl in a tree that is no File tab's.
 *
 * A File tab's tree opens a file chosen with ⌘ or Ctrl in a tab of its own
 * (`SidePanelControl.onBrowseFile`). The Changes tree stands deep in a Pull
 * request tab, a chunk of its own the side panel reads on demand, so the
 * side panel hands the same door down on a context rather than through
 * every layer between, and this module is all it reads of that chunk.
 * Outside a side panel's tab there is no door, and the tree chooses the
 * file in place.
 */

const OpenFileTabContext = createContext<((path: string) => void) | undefined>(undefined);

/** Hands the side panel's door to a file's own tab to every tab under it. */
export const OpenFileTabProvider = OpenFileTabContext.Provider;

/** The door that shows a file of the task's repository in its own File tab; none outside a side panel's tab. */
export function useOpenFileTab(): ((path: string) => void) | undefined {
  return useContext(OpenFileTabContext);
}
