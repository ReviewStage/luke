import {
  FILES_CHANGED_KEY,
  FILES_CHANGED_SHORTCUT_GROUPS,
  FILES_CHANGED_SHORTCUTS,
  filesChangedKeyFor,
} from "@luke/settings/shortcuts";
import {
  Button,
  DIALOG_SIZE,
  Dialog,
  SCROLL_SIZE,
  ScrollArea,
  SETTINGS_ROW_DENSITY,
  SettingsRow,
  SettingsSection,
} from "@luke/ui";
import { useRef } from "react";
import { Shortcut } from "../shortcut.js";

/**
 * files-changed-keys.tsx -- the sheet `?` opens inside Files changed: every one of the view's keys under its group, as stage-cli's sheet lists its own.
 *
 * The keys are read from the table the view's handler matches a press
 * against (`@luke/settings/shortcuts`'s Files changed table), so the sheet
 * lists exactly the keys that answer. Each group is drawn as the Keyboard
 * shortcuts page draws one, `@luke/ui`'s `SettingsSection` with a list row
 * for each key and its chord drawn as every chord is (`Shortcut`), so a key
 * reads the same on the sheet and on the page.
 *
 * The card stands at the wide measure, so each row keeps its chord on the
 * line beside its name, as the page does, rather than dropping it below.
 *
 * The sheet is a `Dialog`, so it holds the keyboard while it stands: Escape,
 * Done, a press on the dimmed window, or `?` again puts it away and hands the
 * focus back inside the view, where the keys answer again.
 */

/** What the sheet says. */
const SHEET_WORDS = {
  TITLE: "Keyboard shortcuts",
  DONE: "Done",
} as const;

export function FilesChangedKeysSheet({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  const done = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={SHEET_WORDS.TITLE}
      size={DIALOG_SIZE.WIDE}
      initialFocus={done}
      onDismiss={onDismiss}
      onKeyDown={(event) => {
        // `?` puts the sheet away as it opened it, as stage-cli's does.
        if (filesChangedKeyFor(event) !== FILES_CHANGED_KEY.SHOW_SHORTCUTS) return;
        event.preventDefault();
        onDismiss();
      }}
      actions={
        <Button ref={done} onClick={onDismiss}>
          {SHEET_WORDS.DONE}
        </Button>
      }
    >
      <ScrollArea size={SCROLL_SIZE.CONTENT}>
        <div className="files-changed-keys">
          {FILES_CHANGED_SHORTCUT_GROUPS.map((group) => (
            <SettingsSection key={group.title} title={group.title}>
              {group.keys.map((key) => (
                <SettingsRow
                  key={key}
                  density={SETTINGS_ROW_DENSITY.LIST}
                  label={FILES_CHANGED_SHORTCUTS[key].label}
                >
                  {() => (
                    <Shortcut
                      className="shortcut-value"
                      chord={FILES_CHANGED_SHORTCUTS[key].chord}
                      spoken
                    />
                  )}
                </SettingsRow>
              ))}
            </SettingsSection>
          ))}
        </div>
      </ScrollArea>
    </Dialog>
  );
}
