import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@sidecar/settings";
import { SchemaSettingRows } from "./schema-rows";
import type { SettingsWrites } from "./writes";

/**
 * How Luke looks and when he starts: his theme and whether he opens at login.
 * A pop-up and a switch, because nothing rides on any answer here.
 */
export function AppearanceSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <section className="settings-section settings-plain">
      <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.APPEARANCE} view={view} writes={writes} />
    </section>
  );
}
