import type { ExperimentChoices, HostCapability } from "@repo/settings";
import { searchAnchorProps } from "@repo/settings/settings-anchors";
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
} from "@repo/settings/shortcuts";
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
} from "@repo/ui";

const RUN_DASH = "–";

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
