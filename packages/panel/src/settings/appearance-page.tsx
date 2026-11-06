import {
  DIFF_SETTING_GROUPS,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  type SettingsRowsInput,
} from "@repo/settings";
import { SettingsSection } from "@repo/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

export function AppearanceSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <>
      <SettingsSection>
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.APPEARANCE} view={view} />
      </SettingsSection>
      {DIFF_SETTING_GROUPS.map(({ section, title }) => (
        <SettingsSection key={section} title={title}>
          <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.APPEARANCE} section={section} view={view} />
        </SettingsSection>
      ))}
    </>
  );
}
