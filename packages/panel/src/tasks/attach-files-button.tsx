import { IconButton, riseAbove, Tooltip, useFilePicker, useMenu } from "@luke/ui";
import { PaperclipIcon } from "@luke/ui/icons";
import { PlusIcon } from "lucide-react";
import { type Ref, useImperativeHandle } from "react";
import { ActionMenu, type PanelMenuEntry } from "../desktop/action-menu.js";

/**
 * attach-files-button.tsx -- the + at a message box's foot: the system's file picker, or, where the box takes more than files, a menu raised over it whose Attachment row opens the picker.
 *
 * The agent box, the Inbox's answer box, a channel's box, and a plan
 * comment's field each stand the same press at their foot's left, its
 * picker hidden beside it. A box that takes nothing but files opens the
 * picker from the + itself, since a menu of one row would only cost a
 * press. A box that takes more, as the agent box takes its MCP servers,
 * hands those rows in (`more`), and the + raises a menu over itself:
 * Attachment first, with a paperclip, then the box's rows in the order it
 * hands them. What a box does with the files picked is its own: each reads
 * them into what it carries (`use-attached-files.ts`). The picker is
 * cleared after each pick, so the same file can be picked again once it was
 * taken off. A box whose overflow menu opens the picker too hands in a ref
 * to open it by.
 */

/** The words a + that takes any file says. */
const ATTACH_FILES = "Attach files";

/** What the + menu's row that opens the file picker is named. */
const ATTACHMENT = "Attachment";

/** What a box holds to open the button's picker from elsewhere. */
export interface AttachPicker {
  open: () => void;
}

/** The + menu's row that opens the file picker, as the + menu and a narrow box's overflow both offer it. */
export function attachmentRow(open: () => void, disabled: boolean): PanelMenuEntry {
  return { label: ATTACHMENT, icon: <PaperclipIcon />, disabled, onSelect: open };
}

export function AttachFilesButton({
  onFiles,
  disabled = false,
  label = ATTACH_FILES,
  accept,
  picker: handed,
  more = [],
}: {
  /** Takes the files picked, in the order the picker handed them. */
  onFiles: (files: readonly File[]) => void;
  disabled?: boolean;
  /** What the press says, where the box takes only some files, or more than files; `ATTACH_FILES` otherwise. */
  label?: string;
  /** The types the picker offers, as an input's `accept` spells them; any file where none is given. */
  accept?: string | undefined;
  /** Filled with a way to open the picker, for a box that opens it from elsewhere too. */
  picker?: Ref<AttachPicker> | undefined;
  /** What the box takes beside files, the rows its + menu offers after Attachment; none opens the picker from the + itself. */
  more?: readonly PanelMenuEntry[] | undefined;
}): React.JSX.Element {
  const picker = useFilePicker({ accept, multiple: true, onFiles });
  useImperativeHandle(handed, () => ({ open: picker.open }));
  const menu = useMenu(true);
  const press = more.length === 0 ? { onClick: picker.open } : menu.trigger(riseAbove);
  return (
    <>
      <Tooltip label={label}>
        <IconButton icon={<PlusIcon />} label={label} disabled={disabled} {...press} />
      </Tooltip>
      {picker.input}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={label}
          menu={menu.drawn}
          groups={[[attachmentRow(picker.open, disabled), ...more]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
