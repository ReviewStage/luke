import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  settingRowsForPage,
} from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * mac-commands-section.tsx -- the This Mac page's groups: whether Luke and coding agents may run shell commands here, then Startup.
 *
 * One choice, Ask every time by default: each command is put to the
 * developer before it runs, or every command runs unasked, or none at all
 * (`compose-mac-commands.ts` in the host stops reading for commands under
 * Never). Startup holds whether Luke opens at login, since it is the Mac
 * that starts him; it stands only where the installed app does, so a page
 * with none of its rows draws no empty heading.
 */
export function MacCommandsSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  const startup =
    settingRowsForPage(SCHEMA_SETTINGS_PAGE.THIS_MAC, SETTING_SECTION.STARTUP, view).length > 0;
  return (
    <>
      <SettingsSection>
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} writes={writes} />
      </SettingsSection>
      {startup ? (
        <SettingsSection title="Startup">
          <SchemaSettingRows
            page={SCHEMA_SETTINGS_PAGE.THIS_MAC}
            section={SETTING_SECTION.STARTUP}
            view={view}
            writes={writes}
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
