import { IconButton, riseAbove, Tooltip, useFilePicker, useMenu } from "@repo/ui";
import { PaperclipIcon } from "@repo/ui/icons";
import { PlusIcon } from "lucide-react";
import { type Ref, useImperativeHandle } from "react";
import { ActionMenu, type MenuEntry } from "../desktop/action-menu.js";

const ATTACH_FILES = "Attach files";

export interface AttachPicker {
  open: () => void;
}

export function attachmentRow(open: () => void, disabled: boolean): MenuEntry {
  return { label: ATTACH_FILES, icon: <PaperclipIcon />, disabled, onSelect: open };
}

export function AttachFilesButton({
  onFiles,
  disabled = false,
  label = ATTACH_FILES,
  accept,
  picker: handed,
  more = [],
}: {
  onFiles: (files: readonly File[]) => void;
  disabled?: boolean;
  label?: string;
  accept?: string | undefined;
  picker?: Ref<AttachPicker> | undefined;
  more?: readonly MenuEntry[] | undefined;
}): React.JSX.Element {
  const picker = useFilePicker({ accept, multiple: true, onFiles });
  useImperativeHandle(handed, () => ({ open: picker.open }));
  const menu = useMenu(true);
  const press = more.length === 0 ? { onClick: picker.open } : menu.trigger(riseAbove);
  return (
    <>
      <Tooltip label={label}>
        <IconButton
          icon={<PlusIcon />}
          label={label}
          disabled={disabled && more.length === 0}
          {...press}
        />
      </Tooltip>
      {picker.input}
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={label}
          menu={menu.drawn}
          groups={[[attachmentRow(picker.open, disabled), ...more]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
