import { useState } from "react";

export interface RenameWrite {
  readonly run: (subjectId: string, name: string) => void;
  readonly asked: { readonly subjectId: string; readonly name: string } | undefined;
  readonly refused: boolean;
  readonly reset: () => void;
}

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

export type InlineRename = ReturnType<typeof useInlineRename>;
