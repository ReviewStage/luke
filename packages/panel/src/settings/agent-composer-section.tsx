import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@luke/settings";
import { SettingsSection } from "@luke/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * agent-composer-section.tsx -- Agents' Message box group: what Enter does in an agent's message box while its turn runs.
 *
 * The one row is the schema's (`agentEnter`), drawn by `SchemaSettingRows`
 * like every stored setting, so the settings search finds it too.
 */
export function AgentComposerSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Message box">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.CODING_AGENTS}
        section={SETTING_SECTION.COMPOSER}
        view={view}
        writes={writes}
      />
    </SettingsSection>
  );
}
