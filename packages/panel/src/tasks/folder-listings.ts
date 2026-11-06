import { TASK_TREE_ENTRY, type TaskTreeEntry } from "@repo/features/task-wire";
import type { TasksTreeAnswer } from "@repo/features/tasks-view";
import type { FolderEntry, FolderListing } from "../file-tree/contract.js";
import { refusalLine, refusalPasses } from "./file-tab-model.js";

export function entriesOf(entries: readonly TaskTreeEntry[]): readonly FolderEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    folder: entry.kind === TASK_TREE_ENTRY.FOLDER,
  }));
}

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
