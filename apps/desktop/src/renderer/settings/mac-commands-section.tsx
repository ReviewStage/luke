import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@sidecar/settings";
import { SchemaSettingRows } from "./schema-rows";
import { SettingsGroup } from "./settings-group";
import type { SettingsWrites } from "./writes";

/**
 * mac-commands-section.tsx -- whether Luke and coding agents may run shell commands on this Mac, the first group of General.
 *
 * One switch, on by default: agents run any command here without asking,
 * and this is the one way to stop them (`compose-mac-commands.ts` in the
 * host stops reading for commands while it is off).
 */
export function MacCommandsSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsGroup title="Commands">
      <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.ROOT} view={view} writes={writes} />
    </SettingsGroup>
  );
}
