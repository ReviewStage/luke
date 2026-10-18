import { Shortcut } from "@luke/panel/shortcut";
import type { ExperimentChoices, HostCapability } from "@luke/settings";
import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { APP_SHORTCUTS, shownShortcutGroups } from "@luke/settings/shortcuts";
import { SETTINGS_ROW_DENSITY, SettingsRow, SettingsSection } from "@luke/ui";

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
 * feature's shortcut is listed only while the account has its experiment on,
 * and a platform feature's only where the platform offers it.
 *
 * Each group is `@luke/ui`'s `SettingsSection` and each command its
 * `SettingsRow` at the list density, a reference's line rather than a
 * setting's, the chord in the row's controls. Note that each row stands
 * in a wrapper wearing its search anchor, because the shared row takes no
 * attribute of a caller's.
 */
export function WindowShortcutSections({
  experiments,
  capabilities,
}: {
  experiments: ExperimentChoices;
  capabilities: readonly HostCapability[];
}): React.JSX.Element {
  return (
    <>
      {shownShortcutGroups(experiments, capabilities).map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          {group.commands.map((command) => (
            <div key={command} {...searchAnchorProps(command)}>
              <SettingsRow density={SETTINGS_ROW_DENSITY.LIST} label={APP_SHORTCUTS[command].label}>
                {() => (
                  <Shortcut
                    className="shortcut-value"
                    chord={APP_SHORTCUTS[command].chord}
                    spoken
                  />
                )}
              </SettingsRow>
            </div>
          ))}
        </SettingsSection>
      ))}
    </>
  );
}
