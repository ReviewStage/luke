import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * privacy-section.tsx -- whether this Luke shares its usage data, the Profile page's Privacy group under Links.
 *
 * The switch is kept on this device, but the counts it stops are sent under
 * the account, so it stands on Profile beside what is the account's.
 */
export function PrivacySection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Privacy">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.PRIVACY}
        view={view}
        writes={writes}
      />
    </SettingsSection>
  );
}
