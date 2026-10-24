import {
  DIFF_SETTING_GROUPS,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  type SettingsRowsInput,
} from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * How Luke looks: his theme and his zoom, in one nameless group, since the
 * page's title already names it; then how code and diffs are drawn, in the
 * groups the schema names (`DIFF_SETTING_GROUPS`): Diff, Lines, and Text, the
 * File tabs' numbers and wrap and every diff setting the Files changed
 * popover offers (`../tasks/view-settings.tsx`), the same stored settings,
 * under the same names and in the same order.
 */
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
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.APPEARANCE} view={view} writes={writes} />
      </SettingsSection>
      {DIFF_SETTING_GROUPS.map(({ section, title }) => (
        <SettingsSection key={section} title={title}>
          <SchemaSettingRows
            page={SCHEMA_SETTINGS_PAGE.APPEARANCE}
            section={section}
            view={view}
            writes={writes}
          />
        </SettingsSection>
      ))}
    </>
  );
}
