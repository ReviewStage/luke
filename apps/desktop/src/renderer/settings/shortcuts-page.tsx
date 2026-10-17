import type { ExperimentChoices } from "@luke/settings";
import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { APP_SHORTCUTS, shownShortcutGroups } from "@luke/settings/shortcuts";
import { Shortcut } from "../shortcut";
import { SettingsGroup } from "./settings-group";

/**
 * shortcuts-page.tsx -- Settings' Keyboard shortcuts page: the window's own shortcuts, grouped as the menu bar groups them, listed to be found rather than changed.
 *
 * Luke's two system-wide keys are not here: they can be changed, so they live
 * on the Voice page beside the voice they reach (`voice-keys.tsx`).
 */

/**
 * The window's own shortcuts rather than keys taken from the machine: each
 * answers only while Luke's window has the keyboard, so they are fixed and
 * listed here to be found, not chosen, under the groups the table keeps —
 * the menu bar's own — each row the command's name and its chord. A gated
 * feature's shortcut is listed only while the account has its experiment on.
 */
export function WindowShortcutSections({
  experiments,
}: {
  experiments: ExperimentChoices;
}): React.JSX.Element {
  return (
    <>
      {shownShortcutGroups(experiments).map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          {group.commands.map((command) => (
            <div
              key={command}
              className="settings-row shortcut-row"
              {...searchAnchorProps(command)}
            >
              <span className="shortcut-name">{APP_SHORTCUTS[command].label}</span>
              <Shortcut chord={APP_SHORTCUTS[command].chord} spoken />
            </div>
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}
