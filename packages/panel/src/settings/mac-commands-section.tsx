import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * mac-commands-section.tsx -- whether Luke and coding agents may run shell commands on this Mac, the This Mac page's one group.
 *
 * One choice, Ask every time by default: each command is put to the
 * developer before it runs, or every command runs unasked, or none at all
 * (`compose-mac-commands.ts` in the host stops reading for commands under
 * Never).
 */
export function MacCommandsSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection>
      <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} writes={writes} />
    </SettingsSection>
  );
}
