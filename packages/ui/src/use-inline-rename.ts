import { useState } from "react";

/**
 * use-inline-rename.ts -- one surface's in-place rename of the thing it draws: whether its `InlineEdit` is open, and whether the name it last asked for was refused.
 */

/**
 * A rename as its caller's mutation stands (`useMutation`): how a name is
 * asked for, the newest one asked, whether it was refused once answered,
 * and the reset that lets it go. Nothing here keeps a rename's pending or
 * refusal of its own.
 */
export interface RenameWrite {
  readonly run: (subjectId: string, name: string) => void;
  /** The newest name asked, by the subject it was asked for, while out or once answered; none once let go of. */
  readonly asked: { readonly subjectId: string; readonly name: string } | undefined;
  /** Whether the newest name asked was refused, once answered. */
  readonly refused: boolean;
  readonly reset: () => void;
}

/**
 * One surface's rename of the subject it draws, by the subject's id: whether
 * its field is open, and the name a refusal left standing beside it until the
 * next edit. Both are held for the subject they were about, so a surface
 * that moves on to another draws neither over it. Note that the field closes
 * as soon as it ends, because the new name is drawn at once, and that a
 * refusal puts the old one back by itself and reopens the field, so the name
 * that was asked for (`asked`) is not lost to a retype: a surface draws the
 * field over `asked ?? name`. Ending that field on no change, or on Escape,
 * lets the refusal go, as a new edit does. The rename is the caller's
 * mutation, whose newest ask alone says whether a refusal stands, so the
 * refusal of a name a later one replaced says nothing of the name drawn now.
 */
export function useInlineRename(subjectId: string | undefined, write: RenameWrite) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const begin = () => {
    write.reset();
    setEditing(subjectId);
  };
  const end = (name: string | undefined) => {
    setEditing(undefined);
    if (subjectId === undefined || name === undefined) {
      write.reset();
      return;
    }
    write.run(subjectId, name);
  };
  const shown = subjectId !== undefined;
  const refused = shown && write.refused && write.asked?.subjectId === subjectId;
  return {
    editing: shown && (editing === subjectId || refused),
    begin,
    end,
    refused,
    asked: refused ? write.asked?.name : undefined,
  };
}

/** One surface's in-place rename, as `useInlineRename` answers it. */
export type InlineRename = ReturnType<typeof useInlineRename>;
