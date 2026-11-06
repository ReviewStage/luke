import { type JSX, useRef } from "react";

export interface FilePickerOptions {
  accept?: string | undefined;
  multiple?: boolean;
  onFiles: (files: readonly File[]) => void;
}

export interface FilePicker {
  open: () => void;
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
        className="ph-no-capture"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          onFiles(picked);
        }}
      />
    ),
  };
}
