import type { ExperimentChoices, HostCapability } from "@luke/settings";
import { searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  APP_SHORTCUTS,
  CHAPTERS_GROUP_TITLE,
  CHAPTERS_KEYS,
  CHAPTERS_SHORTCUTS,
  FILES_CHANGED_GROUP_TITLE,
  FILES_CHANGED_KEYS_LISTED,
  FILES_CHANGED_SHORTCUTS,
  IN_CONTEXT_SHORTCUTS,
  type InContextKey,
  type InContextShortcut,
  inContextShown,
  shortcutLabel,
  shownShortcutGroups,
  WRITING_ACTIONS_LISTED,
  WRITING_GROUP_TITLE,
  WRITING_KEYS_IN_CONTEXT,
  WRITING_SHORTCUTS,
  type WritingAction,
  type WritingShortcut,
} from "@luke/settings/shortcuts";
import {
  SETTINGS_ROW_DENSITY,
  SettingsRow,
  SettingsSection,
  Shortcut,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";

/**
 * shortcuts-page.tsx -- Settings' Keyboard shortcuts page: the window's own shortcuts and the keys that answer in place, grouped by what they act on, listed to be found rather than changed.
 */

/** What stands between the first and the last key of a run, 1 – 9. */
const RUN_DASH = "–";

/**
 * The window's own shortcuts rather than keys taken from the machine: each
 * answers only while Luke's window has the keyboard, so they are fixed and
 * listed here to be found, not chosen, under the groups the table keeps
 * (`APP_SHORTCUT_GROUPS`), by what they act on: each row the command's name
 * and its chord, then the group's keys that answer in place, where focus or
 * a selection stands (`IN_CONTEXT_SHORTCUTS`). Escape is one row, under
 * General, for every layer it steps back from. A gated feature's shortcut is
 * listed only while the account has its experiment on, and a platform
 * feature's only where the platform offers it.
 *
 * Each group is `@luke/ui`'s `SettingsSection` and each command its
 * `SettingsRow` at the list density, a reference's line rather than a
 * setting's, the chord in the row's controls. Note that each row stands
 * in a wrapper wearing its search anchor, because the shared row takes no
 * attribute of a caller's.
 *
 * Writing follows them, read from the vocabulary the editors bind their
 * chords from: each mark and block with the Markdown typed in text that makes
 * it, where there is one, and its chord, where it has one, then a link's ⌘K
 * over selected words and the `@` list's keys. Files changed's
 * own keys follow under a group of their own, read from the
 * table the view's handler answers to (`changes-list.tsx`), the order its
 * `?` sheet lists them in, and Chapters' after them (`agent-chapters-tab.tsx`).
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
              <SettingsRow
                density={SETTINGS_ROW_DENSITY.LIST}
                label={shortcutLabel(command, experiments)}
              >
                {() => <Shortcut value chord={APP_SHORTCUTS[command].chord} spoken />}
              </SettingsRow>
            </div>
          ))}
          {group.keys.map((key) => (
            <InContextRow key={key} inContext={key} />
          ))}
        </SettingsSection>
      ))}
      <SettingsSection title={WRITING_GROUP_TITLE}>
        {WRITING_ACTIONS_LISTED.map((action) => (
          <div key={action} {...searchAnchorProps(action)}>
            <SettingsRow
              density={SETTINGS_ROW_DENSITY.LIST}
              label={WRITING_SHORTCUTS[action].label}
            >
              {() => <WritingKeys action={action} />}
            </SettingsRow>
          </div>
        ))}
        {WRITING_KEYS_IN_CONTEXT.filter((key) => inContextShown(key, capabilities)).map((key) => (
          <InContextRow key={key} inContext={key} />
        ))}
      </SettingsSection>
      <SettingsSection title={FILES_CHANGED_GROUP_TITLE}>
        {FILES_CHANGED_KEYS_LISTED.map((key) => (
          <div key={key} {...searchAnchorProps(key)}>
            <SettingsRow
              density={SETTINGS_ROW_DENSITY.LIST}
              label={FILES_CHANGED_SHORTCUTS[key].label}
            >
              {() => <Shortcut value chord={FILES_CHANGED_SHORTCUTS[key].chord} spoken />}
            </SettingsRow>
          </div>
        ))}
      </SettingsSection>
      <SettingsSection title={CHAPTERS_GROUP_TITLE}>
        {CHAPTERS_KEYS.map((key) => (
          <div key={key} {...searchAnchorProps(key)}>
            <SettingsRow density={SETTINGS_ROW_DENSITY.LIST} label={CHAPTERS_SHORTCUTS[key].label}>
              {() => <Shortcut value chord={CHAPTERS_SHORTCUTS[key].chord} spoken />}
            </SettingsRow>
          </div>
        ))}
      </SettingsSection>
    </>
  );
}

/** A key that answers in place: its name, then its chord, or the first and the last of a run of keys, 1 – 9. */
function InContextRow({ inContext }: { inContext: InContextKey }): React.JSX.Element {
  const { label, chord, through }: InContextShortcut = IN_CONTEXT_SHORTCUTS[inContext];
  return (
    <div {...searchAnchorProps(inContext)}>
      <SettingsRow density={SETTINGS_ROW_DENSITY.LIST} label={label}>
        {() => (
          <>
            <Shortcut value chord={chord} spoken />
            {through === undefined ? null : (
              <>
                <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
                  {RUN_DASH}
                </Text>
                <Shortcut value chord={through} spoken />
              </>
            )}
          </>
        )}
      </SettingsRow>
    </div>
  );
}

/** A writing action's Markdown rule, set as the code it is, then its chord: whichever of the two it has. */
function WritingKeys({ action }: { action: WritingAction }): React.JSX.Element {
  const { markdown, chord }: WritingShortcut = WRITING_SHORTCUTS[action];
  return (
    <>
      {markdown === undefined ? null : (
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.LABEL}
          tone={TEXT_TONE.MUTED}
          font={TEXT_FONT.MONO}
        >
          {markdown}
        </Text>
      )}
      {chord === undefined ? null : <Shortcut value chord={chord} spoken />}
    </>
  );
}
