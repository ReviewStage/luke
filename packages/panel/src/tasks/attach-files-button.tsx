import { IconButton } from "@luke/ui";
import { PlusIcon } from "lucide-react";
import { type RefObject, useRef } from "react";
import { Tooltip } from "../tooltip.js";

/**
 * attach-files-button.tsx -- the + at a message box's foot that opens the system's file picker, as every box that takes files draws it.
 *
 * The agent box, the Inbox's answer box, a channel's box, and a plan
 * comment's field each stand the same press at their foot's left, its
 * picker hidden beside it. What a box does with the files picked is its
 * own: each reads them into what it carries (`attached-files.ts`). The
 * picker is cleared after each pick, so the same file can be picked again
 * once it was taken off. A box whose overflow menu opens the picker too
 * hands in its own ref to it.
 */

/** The words a + that takes any file says. */
export const ATTACH_FILES = "Attach files";

export function AttachFilesButton({
  onFiles,
  disabled = false,
  label = ATTACH_FILES,
  accept,
  picker: handed,
}: {
  /** Takes the files picked, in the order the picker handed them. */
  onFiles: (files: readonly File[]) => void;
  disabled?: boolean;
  /** What the press says, where the box takes only some files; `ATTACH_FILES` otherwise. */
  label?: string;
  /** The types the picker offers, as an input's `accept` spells them; any file where none is given. */
  accept?: string | undefined;
  /** The picker itself, for a box that opens it from elsewhere too; the button keeps its own where none is handed. */
  picker?: RefObject<HTMLInputElement | null> | undefined;
}): React.JSX.Element {
  const own = useRef<HTMLInputElement>(null);
  const picker = handed ?? own;
  return (
    <>
      <Tooltip label={label}>
        <IconButton
          icon={<PlusIcon />}
          label={label}
          disabled={disabled}
          onClick={() => picker.current?.click()}
        />
      </Tooltip>
      <input
        ref={picker}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.files ?? []);
          // Cleared so the same file can be picked again after it was taken off.
          event.currentTarget.value = "";
          onFiles(picked);
        }}
      />
    </>
  );
}
