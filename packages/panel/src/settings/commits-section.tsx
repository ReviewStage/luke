import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { SettingsSection } from "@repo/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * commits-section.tsx -- the Account page's Commits group: who authors an agent's commits and opens its pull request, which the account carries across its Macs and the web.
 *
 * The one row is the schema's (`commitAuthor`), drawn by `SchemaSettingRows`
 * like every stored setting, so the settings search finds it too.
 */
export function CommitsSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Commits">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.ACCOUNT}
        section={SETTING_SECTION.COMMITS}
        view={view}
        writes={writes}
      />
    </SettingsSection>
  );
}
