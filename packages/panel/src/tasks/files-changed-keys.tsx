import {
  FILES_CHANGED_KEY,
  FILES_CHANGED_SHORTCUT_GROUPS,
  FILES_CHANGED_SHORTCUTS,
  filesChangedKeyFor,
} from "@repo/settings/shortcuts";
import {
  Button,
  DIALOG_SIZE,
  Dialog,
  SCROLL_SIZE,
  ScrollArea,
  SETTINGS_ROW_DENSITY,
  SettingsRow,
  SettingsSection,
  Shortcut,
} from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useRef } from "react";

const SHEET_WORDS = {
  TITLE: "Keyboard shortcuts",
  DONE: "Done",
} as const;

export function FilesChangedKeysSheet({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void;
}): React.JSX.Element {
  const done = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      title={SHEET_WORDS.TITLE}
      size={DIALOG_SIZE.WIDE}
      replayUnmasked
      initialFocus={done}
      onDismiss={onDismiss}
      onKeyDown={(event) => {
        if (filesChangedKeyFor(event) !== FILES_CHANGED_KEY.SHOW_SHORTCUTS) return;
        event.preventDefault();
        onDismiss();
      }}
      actions={
        <Button ref={done} onClick={onDismiss}>
          <ReplayUnmask>{SHEET_WORDS.DONE}</ReplayUnmask>
        </Button>
      }
    >
      <ScrollArea size={SCROLL_SIZE.CONTENT}>
        <div className="flex flex-col gap-page-section-gap">
          {FILES_CHANGED_SHORTCUT_GROUPS.map((group) => (
            <SettingsSection key={group.title} title={group.title}>
              {group.keys.map((key) => (
                <SettingsRow
                  key={key}
                  density={SETTINGS_ROW_DENSITY.LIST}
                  label={FILES_CHANGED_SHORTCUTS[key].label}
                >
                  {() => <Shortcut value chord={FILES_CHANGED_SHORTCUTS[key].chord} spoken />}
                </SettingsRow>
              ))}
            </SettingsSection>
          ))}
        </div>
      </ScrollArea>
    </Dialog>
  );
}
