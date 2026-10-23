import { useState } from "react";

/**
 * use-file-drop.ts -- a card that takes files dropped on it: whether a drag of files is over it, and the three handlers that hear one.
 *
 * A drag of anything but files passes over untouched. A drag of files is
 * taken where the card takes one now, which rings it (`dropping`) until the
 * drag leaves or drops; a drop hands the card the files.
 */

/** When a drag of files has left the card. */
export const DROP_LEAVE = {
  /** Once it moves onto anything outside the card: onto one of its own children it has not left. */
  OUTSIDE: "outside",
  /** Once it moves off the window altogether, for a target that covers it, as a dialog's dimmed window does. */
  WINDOW: "window",
} as const;

export type DropLeave = (typeof DROP_LEAVE)[keyof typeof DROP_LEAVE];

/** What a card takes: whether a drag over it may ring it, whether a drop on it is taken, and when a drag has left. */
export interface FileDropOptions {
  readonly over?: boolean | undefined;
  readonly drop?: boolean | undefined;
  readonly leave?: DropLeave | undefined;
}

/** The handlers a drop target spreads, and whether files are over it. */
export interface FileDrop {
  readonly dropping: boolean;
  /** Puts the ring away, whatever became of the drag. */
  readonly clear: () => void;
  readonly target: {
    readonly onDragOver: (event: React.DragEvent<Element>) => void;
    readonly onDragLeave: (event: React.DragEvent<Element>) => void;
    readonly onDrop: (event: React.DragEvent<Element>) => void;
  };
}

/** Whether a drag carries files, which is all a drop target here takes from one. */
function carriesFiles(event: React.DragEvent<Element>): boolean {
  return event.dataTransfer.types.includes("Files");
}

/** A drop target that hands `take` the files dropped on it, on the terms `options` sets. */
export function useFileDrop(
  take: (files: FileList) => void,
  { over = true, drop = true, leave = DROP_LEAVE.OUTSIDE }: FileDropOptions = {},
): FileDrop {
  const [dropping, setDropping] = useState(false);
  return {
    dropping,
    clear: () => setDropping(false),
    target: {
      onDragOver: (event) => {
        if (!carriesFiles(event) || !over) return;
        event.preventDefault();
        setDropping(true);
      },
      onDragLeave: (event) => {
        const into = event.relatedTarget;
        const left =
          leave === DROP_LEAVE.WINDOW
            ? into === null
            : !(into instanceof Node && event.currentTarget.contains(into));
        if (left) setDropping(false);
      },
      onDrop: (event) => {
        if (!carriesFiles(event) || !drop) return;
        event.preventDefault();
        setDropping(false);
        take(event.dataTransfer.files);
      },
    },
  };
}
