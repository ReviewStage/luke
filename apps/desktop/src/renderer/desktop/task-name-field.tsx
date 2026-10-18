import { RENAME_FAILED_NOTE } from "@luke/ui/tasks-model";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * task-name-field.tsx -- a name edited where it is drawn, on Settings › Workspace, an integration's account, or a shell, and the rename a task's or an agent's name asks for wherever it is edited.
 *
 * The field opens over the name with all of it selected. Return or a press
 * elsewhere keeps what was typed, and Escape keeps the name it opened on; a
 * name left empty or unchanged renames nothing. Its words are an input's
 * value, which session replay masks as it masks every input. A task's and
 * an agent's name are edited in `@luke/ui`'s `InlineEdit`, the sidebar's
 * row and the tabs' alike, and renamed through `useTaskRename` below: what
 * differs between them is the name said for a reader and the bound.
 */

/** How an edit ended: what to rename it to, if anything, and whether a key ended it, so focus goes back to the name. */
export interface NameEdit {
  readonly name: string | undefined;
  readonly byKey: boolean;
}

/** The field itself. It ends once, whichever of Return, Escape, or the focus leaving comes first. */
export function TaskNameField({
  name,
  className,
  label,
  maxLength,
  onEnd,
}: {
  name: string;
  className: string;
  /** What the field is called for a reader. */
  label: string;
  maxLength: number;
  onEnd: (edit: NameEdit) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const ended = useRef(false);
  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const end = (keep: boolean, byKey: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const typed = field.current?.value.trim() ?? "";
    onEnd({ name: keep && typed !== "" && typed !== name ? typed : undefined, byKey });
  };

  return (
    <input
      ref={field}
      type="text"
      className={className}
      aria-label={label}
      defaultValue={name}
      maxLength={maxLength}
      spellCheck={false}
      onBlur={() => end(true, false)}
      onKeyDown={(event) => {
        // Note that Escape goes no further than the field, because the
        // window's own Escape would otherwise leave the task as well.
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          end(false, true);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          end(true, true);
        }
      }}
    />
  );
}

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
