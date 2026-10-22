import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * links-section.tsx -- where the account's Luke links open, the Profile page's Links group under who is signed in.
 *
 * The account's own choice, carried to every device and read by the web as
 * a link loads (`@luke/features/link-open`), so it stands on Profile, among
 * what is the account's, rather than on a page of this Mac's.
 */
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
        writes={writes}
      />
    </SettingsSection>
  );
}
