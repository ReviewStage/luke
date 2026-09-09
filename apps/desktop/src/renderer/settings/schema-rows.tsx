import { APP_SETTING_KIND, APP_TOGGLE_VALUE } from "@sidecar/guide";
import {
  isAppSettingId,
  type SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingSection,
  type SettingsRowsInput,
  settingFromOption,
  settingRowsForPage,
} from "@sidecar/settings";
import type { AppSettingField } from "@sidecar/settings/wire";
import { SelectRow } from "./select-row";
import { SwitchRow } from "./switch-row";
import type { SettingsWrites } from "./writes";

/**
 * Every ordinary row one section of a settings page draws, from the schema and
 * nothing else: which page and section a setting stands in, where in that
 * section, whether it is drawn right now, and what its control offers are the
 * entry's own answers. A page component that decided any of it for itself would
 * be a second record of the same fact, and the two would drift.
 */
export function SchemaSettingRows({
  page,
  section = SETTING_SECTION.MAIN,
  view,
  writes,
  details,
}: {
  page: (typeof SCHEMA_SETTINGS_PAGE)[keyof typeof SCHEMA_SETTINGS_PAGE];
  section?: SettingSection;
  view: SettingsRowsInput;
  writes: SettingsWrites;
  details?: Partial<Record<AppSettingField, string>>;
}): React.JSX.Element {
  const rows = settingRowsForPage(page, section, view).flatMap((row) => {
    const { field, entry, changed, control } = row;
    if (entry.kind === APP_SETTING_KIND.TOGGLE) {
      return [
        <SwitchRow
          key={entry.id}
          label={entry.label}
          ariaLabel={entry.description}
          {...(isAppSettingId(entry.id) ? { errand: entry.id } : undefined)}
          detail={details?.[field]}
          changed={changed}
          checked={entry.value === APP_TOGGLE_VALUE.ON}
          onChange={(enabled) => writes.setting(field, enabled)}
        />,
      ];
    }
    if (entry.kind !== APP_SETTING_KIND.CHOICE || !control) return [];
    return [
      <SelectRow
        key={entry.id}
        label={entry.label}
        ariaLabel={entry.description}
        {...(isAppSettingId(entry.id) ? { errand: entry.id } : undefined)}
        detail={details?.[field]}
        changed={changed}
        value={control.value}
        options={control.options.map((option) => ({ ...option }))}
        parse={(raw) => (control.options.some((option) => option.value === raw) ? raw : undefined)}
        onChange={(token) => writes.setting(field, settingFromOption(field, token, view))}
      />,
    ];
  });
  return <>{rows}</>;
}
