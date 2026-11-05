import {
  isAppSettingId,
  type SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingSection,
  type SettingsRowsInput,
  settingFromOption,
  settingRowsForPage,
} from "@repo/settings";
import type { ActionResult } from "@repo/wire";
import { APP_SETTING_KIND, APP_TOGGLE_VALUE } from "@repo/wire/app-settings";
import { SelectRow } from "./select-row.js";
import { SwitchRow } from "./switch-row.js";
import type { SettingsWrites } from "./writes.js";

/** One value a choice's control offers, as the schema hands it. */
type SettingOption = NonNullable<
  ReturnType<typeof settingRowsForPage>[number]["control"]
>["options"][number];

/**
 * A choice's row: the shared pop-up (`select-row.tsx`), whose menu searches
 * where the schema gives the set a search field and reads whole where it
 * does not. A set whose values have faces is a `PictureChoiceRow`, never this.
 */
function SchemaChoiceRow({
  id,
  label,
  detail,
  changed,
  value,
  options,
  search,
  onChange,
}: {
  id: string;
  label: string;
  detail: string | undefined;
  changed: boolean;
  value: string;
  options: readonly SettingOption[];
  /** The searchable menu's empty field words, for a set long enough to search. */
  search: string | undefined;
  onChange: (token: string) => Promise<ActionResult>;
}): React.JSX.Element {
  return (
    <SelectRow
      label={label}
      labelReplayUnmasked
      detail={detail}
      changed={changed}
      value={value}
      options={options}
      // A token the set does not hold, or the one already stored, is not written, so a stale menu or a repeat pick writes nothing.
      parse={(token) =>
        token !== value && options.some((option) => option.value === token) ? token : undefined
      }
      placeholder={search}
      {...(isAppSettingId(id) ? { anchor: id } : undefined)}
      onChange={onChange}
    />
  );
}

/**
 * Every ordinary row one section of a settings page draws, from the schema and
 * nothing else: which page and section a setting stands in, where in that
 * section, whether it is drawn right now, what its control offers, and the
 * line drawn under its label are the entry's own answers. A page component that decided any of it for itself would
 * be a second record of the same fact, and the two would drift.
 */
export function SchemaSettingRows({
  page,
  section = SETTING_SECTION.MAIN,
  view,
  writes,
}: {
  page: (typeof SCHEMA_SETTINGS_PAGE)[keyof typeof SCHEMA_SETTINGS_PAGE];
  section?: SettingSection;
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  const rows = settingRowsForPage(page, section, view).flatMap((row) => {
    const { field, entry, changed, control } = row;
    if (entry.kind === APP_SETTING_KIND.TOGGLE) {
      return [
        <SwitchRow
          key={entry.id}
          {...(isAppSettingId(entry.id) ? { anchor: entry.id } : undefined)}
          label={entry.label}
          labelReplayUnmasked
          detail={entry.detail}
          changed={changed}
          checked={entry.value === APP_TOGGLE_VALUE.ON}
          onChange={(enabled) => writes.setting(field, enabled)}
        />,
      ];
    }
    if (entry.kind !== APP_SETTING_KIND.CHOICE || !control) return [];
    return [
      <SchemaChoiceRow
        key={entry.id}
        id={entry.id}
        label={entry.label}
        detail={entry.detail}
        changed={changed}
        value={control.value}
        options={control.options}
        search={control.search}
        onChange={(token) => writes.setting(field, settingFromOption(field, token, view))}
      />,
    ];
  });
  return <>{rows}</>;
}
