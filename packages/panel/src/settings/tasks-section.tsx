import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * tasks-section.tsx -- whether a task New task starts opens, the Profile page's Tasks group under Links.
 *
 * The switch is kept on this device, but tasks are the account's, so it
 * stands on Profile beside what is the account's, as Privacy does.
 */
export function TasksSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Tasks">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.TASKS}
        view={view}
        writes={writes}
      />
    </SettingsSection>
  );
}
