import { TASK_TREE_ENTRY, type TaskTreeEntry } from "@repo/features/task-wire";
import type { TasksTreeAnswer } from "@repo/features/tasks-view";
import type { FolderEntry, FolderListing } from "../file-tree/contract.js";
import { refusalLine, refusalPasses } from "./file-tab-model.js";

/**
 * folder-listings.ts -- a listing of a task's repository in the tree bundle's own words, as a File tab's tree and breadcrumbs hand it on (`listingOf`).
 *
 * The listings themselves are read and held through TanStack Query
 * (`repository-reads.ts`), so a folder is listed once however many ask.
 */

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
