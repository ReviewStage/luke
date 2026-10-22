import { type JSX, useRef } from "react";

/**
 * file-picker.tsx -- the system's file picker, opened from a `Button` or `IconButton` the caller draws.
 *
 * `useFilePicker` owns the hidden `<input type="file">`: the caller draws
 * `input` once beside its button and calls `open` from the press (or from a
 * menu row, a command). The picker is cleared after each pick, so the same
 * file can be picked again once it was taken off; `onFiles` hears the files
 * in the order the picker handed them, at most one where `multiple` is off.
 */

export interface FilePickerOptions {
  /** The types the picker offers, as an input's `accept` spells them; any file where none is given. */
  accept?: string | undefined;
  /** Whether more than one file can be picked at once. */
  multiple?: boolean;
  /** Takes the files picked. */
  onFiles: (files: readonly File[]) => void;
}

export interface FilePicker {
  /** Opens the system's picker. */
  open: () => void;
  /** The hidden input; drawn once, anywhere in the caller's tree. */
  input: JSX.Element;
}

export function useFilePicker({
  accept,
  multiple = false,
  onFiles,
}: FilePickerOptions): FilePicker {
  const element = useRef<HTMLInputElement>(null);
  return {
    open: () => element.current?.click(),
    input: (
      <input
        ref={element}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.files ?? []);
          // Cleared so the same file can be picked again after it was taken off.
          event.currentTarget.value = "";
          onFiles(picked);
        }}
      />
    ),
  };
}
