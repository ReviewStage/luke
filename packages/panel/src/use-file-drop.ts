import { useState } from "react";

export const DROP_LEAVE = {
  OUTSIDE: "outside",
  WINDOW: "window",
} as const;

type DropLeave = (typeof DROP_LEAVE)[keyof typeof DROP_LEAVE];

export interface FileDropOptions {
  readonly over?: boolean | undefined;
  readonly drop?: boolean | undefined;
  readonly leave?: DropLeave | undefined;
}

export interface FileDrop {
  readonly dropping: boolean;
  readonly clear: () => void;
  readonly target: {
    readonly onDragOver: (event: React.DragEvent<Element>) => void;
    readonly onDragLeave: (event: React.DragEvent<Element>) => void;
    readonly onDrop: (event: React.DragEvent<Element>) => void;
  };
}

function carriesFiles(event: React.DragEvent<Element>): boolean {
  return event.dataTransfer.types.includes("Files");
}

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
