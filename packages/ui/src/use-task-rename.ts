import { useRef, useState } from "react";
import { RENAME_FAILED_NOTE } from "./tasks-model.js";

/**
 * use-task-rename.ts -- the rename a task's or an agent's name asks for, wherever an `InlineEdit` edits it: the sidebar's row, the plan's tab, or an agent's.
 */

/**
 * One surface's rename of the task, or the agent, it draws: whether its
 * field is open, and the note a refusal leaves beside the name until the
 * next edit. Both are held for the one they were about, so a surface that
 * moves on to another draws neither over it. Note that the field closes as soon as it ends,
 * because the new name is drawn at once and a refusal puts the old one back
 * by itself. Each edit is counted, and so is each name it asks for, since
 * the title asks again at every pause in the typing, so the refusal of one
 * a later edit or name has replaced says nothing about the name drawn now.
 */
export function useTaskRename(
  taskId: string | undefined,
  onRename: (taskId: string, name: string) => Promise<boolean>,
) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const edits = useRef(0);
  const begin = () => {
    edits.current += 1;
    setRefused(undefined);
    setEditing(taskId);
  };
  // Answers whether the name asked for was taken; an edit that asks for none has nothing refused.
  const end = (name: string | undefined): Promise<boolean> => {
    setEditing(undefined);
    if (taskId === undefined || name === undefined) return Promise.resolve(true);
    edits.current += 1;
    setRefused(undefined);
    const edit = edits.current;
    const refuse = () => {
      if (edit === edits.current) setRefused(taskId);
      return false;
    };
    return onRename(taskId, name).then((renamed) => renamed || refuse(), refuse);
  };
  const shown = taskId !== undefined;
  return {
    editing: shown && editing === taskId,
    begin,
    end,
    note: shown && refused === taskId ? RENAME_FAILED_NOTE : undefined,
  };
}
