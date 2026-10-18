import { TASK_TREE_ENTRY, type TaskTreeEntry } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TasksTreeAnswer } from "@luke/features/tasks-view";
import type { FolderEntry, FolderListing } from "@luke/panel/file-tree/contract";
import { refusalLine, refusalPasses } from "./file-tab-model";

/**
 * folder-listings.ts -- the folders of a task's repository a File tab's tree and breadcrumbs have listed, so a folder is listed once however many of them ask.
 *
 * A folder is listed once and the listing kept, the one in flight shared by
 * whoever asks meanwhile; a listing that did not land, or that the service
 * refused, is not kept, so the next ask lists it again. The store is the
 * File view's (`file-view.tsx`), which stands across File tabs, so moving
 * between them lists nothing twice, and coming back to a File tab from
 * another tab lists the repository afresh, as GitHub holds it then. Both
 * hand a listing to the tree bundle in its own words (`listingOf`).
 */

/** Lists one folder of the repository, the root for the empty path. */
export type ListFolder = (path: string) => Promise<TasksTreeAnswer>;

/** Lists folders through `read`, each kept once it is listed; a rejection reads as unanswered. */
export function keptListings(read: ListFolder): ListFolder {
  const kept = new Map<string, Promise<TasksTreeAnswer>>();
  return (path) => {
    const standing = kept.get(path);
    if (standing !== undefined) return standing;
    const listing = read(path).then(
      (answer) => {
        if (!("folder" in answer)) kept.delete(path);
        return answer;
      },
      (): TasksTreeAnswer => {
        kept.delete(path);
        return { failure: TASK_CALL_FAILURE.UNANSWERED };
      },
    );
    kept.set(path, listing);
    return listing;
  };
}

/** A listing's entries as the tree hears them, each by its name or, listed whole, its path. */
export function entriesOf(entries: readonly TaskTreeEntry[]): readonly FolderEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    folder: entry.kind === TASK_TREE_ENTRY.FOLDER,
  }));
}

/** A folder's listing as the tree hears it: its entries, or why it is not listed and whether listing again may help. */
export function listingOf(answer: TasksTreeAnswer): FolderListing {
  if ("folder" in answer) {
    return {
      entries: entriesOf(answer.folder.entries),
      truncated: answer.folder.truncated,
    };
  }
  if ("failure" in answer) return { notice: "The files could not be read.", retry: true };
  return {
    notice: refusalLine(answer.refusal, answer.branch),
    retry: refusalPasses(answer.refusal),
  };
}
