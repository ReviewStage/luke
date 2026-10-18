import { useRef, useState } from "react";

/**
 * use-inline-rename.ts -- one surface's in-place rename of the thing it draws: whether its `InlineEdit` is open, and whether the name it last asked for was refused.
 */

/**
 * One surface's rename of the subject it draws, by the subject's id: whether
 * its field is open, and whether a refusal stands beside the name until the
 * next edit. Both are held for the subject they were about, so a surface
 * that moves on to another draws neither over it. Note that the field closes
 * as soon as it ends, because the new name is drawn at once and a refusal
 * puts the old one back by itself. Each edit is counted, and so is each name
 * it asks for, since a caller may ask again at every pause in the typing, so
 * the refusal of one a later edit or name has replaced says nothing about the
 * name drawn now. What renames, and what a refusal says, are the caller's.
 */
export function useInlineRename(
  subjectId: string | undefined,
  onRename: (subjectId: string, name: string) => Promise<boolean>,
) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const edits = useRef(0);
  const begin = () => {
    edits.current += 1;
    setRefused(undefined);
    setEditing(subjectId);
  };
  // Answers whether the name asked for was taken; an edit that asks for none has nothing refused.
  const end = (name: string | undefined): Promise<boolean> => {
    setEditing(undefined);
    if (subjectId === undefined || name === undefined) return Promise.resolve(true);
    edits.current += 1;
    setRefused(undefined);
    const edit = edits.current;
    const refuse = () => {
      if (edit === edits.current) setRefused(subjectId);
      return false;
    };
    return onRename(subjectId, name).then((renamed) => renamed || refuse(), refuse);
  };
  const shown = subjectId !== undefined;
  return {
    editing: shown && editing === subjectId,
    begin,
    end,
    refused: shown && refused === subjectId,
  };
}

/** One surface's in-place rename, as `useInlineRename` answers it. */
export type InlineRename = ReturnType<typeof useInlineRename>;
