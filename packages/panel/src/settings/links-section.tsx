import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { SettingsSection } from "@repo/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

export function LinksSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Links">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.LINKS}
        view={view}
      />
    </SettingsSection>
  );
}
