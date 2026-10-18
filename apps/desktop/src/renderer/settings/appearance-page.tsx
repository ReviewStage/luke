import type { SettingsWrites } from "@luke/panel/settings/writes";
import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows";

/**
 * How Luke looks and when he starts: his theme, his zoom, and whether he
 * opens at login, in one nameless group, since the page's title already
 * names it; then how code and diffs are drawn, under Diffs: the File tabs'
 * numbers and wrap, and every diff setting the Files changed popover offers
 * (`../tasks/diff-settings.tsx`), the same stored settings.
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
      <SettingsSection title="Diffs">
        <SchemaSettingRows
          page={SCHEMA_SETTINGS_PAGE.APPEARANCE}
          section={SETTING_SECTION.DIFFS}
          view={view}
          writes={writes}
        />
      </SettingsSection>
    </>
  );
}
