import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@sidecar/settings";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { SchemaSettingRows } from "./schema-rows";
import type { SettingsWrites } from "./writes";

/**
 * Where Luke stands and how he is drawn: the Dock as a second door, every
 * display or just the main one, and the form he takes on a display
 * without a housing. Switches and one pop-up, because nothing rides on any
 * answer here.
 */
export function AppearanceSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <section
      className="settings-section settings-plain"
      style={cssCustomProperties({ "--row-index": 1 })}
    >
      <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.APPEARANCE} view={view} writes={writes} />
    </section>
  );
}
