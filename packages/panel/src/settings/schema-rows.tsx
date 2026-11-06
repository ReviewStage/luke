import {
  type AppSettingField,
  isAppSettingId,
  type SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingSection,
  type SettingsRowsInput,
  settingFromOption,
  settingRowsForPage,
} from "@repo/settings";
import { APP_SETTING_KIND, APP_TOGGLE_VALUE } from "@repo/wire/app-settings";
import { useSettingRowWrite } from "./row-write.js";
import { SelectRow } from "./select-row.js";
import { SwitchRow } from "./switch-row.js";

/** One value a choice's control offers, as the schema hands it. */
type SettingOption = NonNullable<
  ReturnType<typeof settingRowsForPage>[number]["control"]
>["options"][number];

/** A toggle's row: the shared switch (`switch-row.tsx`), writing its setting through a mutation of its own. */
function SchemaToggleRow({
  id,
  field,
  label,
  detail,
  changed,
  checked,
}: {
  id: string;
  field: AppSettingField;
  label: string;
  detail: string | undefined;
  changed: boolean;
  checked: boolean;
}): React.JSX.Element {
  const write = useSettingRowWrite(
    field,
    (enabled: boolean) => enabled,
    (value) => value === true,
    true,
  );
  return (
    <SwitchRow
      {...(isAppSettingId(id) ? { anchor: id } : undefined)}
      label={label}
      labelReplayUnmasked
      detail={detail}
      changed={changed}
      checked={checked}
      write={write}
    />
  );
}

/**
 * A choice's row: the shared pop-up (`select-row.tsx`), whose menu searches
 * where the schema gives the set a search field and reads whole where it
 * does not, each option wearing the faces its section hands it, where it
 * hands some, writing its setting through a mutation of its own.
 */
function SchemaChoiceRow({
  id,
  field,
  view,
  label,
  detail,
  changed,
  value,
  options,
  search,
  faces,
}: {
  id: string;
  field: AppSettingField;
  view: SettingsRowsInput;
  label: string;
  detail: string | undefined;
  changed: boolean;
  value: string;
  options: readonly SettingOption[];
  /** What an option's token shows beside its words, where it shows anything. */
  faces: ((token: string) => React.ReactNode) | undefined;
  /** The searchable menu's empty field words, for a set long enough to search. */
  search: string | undefined;
}): React.JSX.Element {
  const write = useSettingRowWrite(field, (token: string) => settingFromOption(field, token, view));
  return (
    <SelectRow
      label={label}
      labelReplayUnmasked
      detail={detail}
      changed={changed}
      value={value}
      options={
        faces === undefined
          ? options
          : options.map((option) => ({ ...option, faces: faces(option.value) }))
      }
      // A token the set does not hold, or the one already stored, is not written, so a stale menu or a repeat pick writes nothing.
      parse={(token) =>
        token !== value && options.some((option) => option.value === token) ? token : undefined
      }
      placeholder={search}
      {...(isAppSettingId(id) ? { anchor: id } : undefined)}
      write={write}
    />
  );
}

/**
 * Every ordinary row one section of a settings page draws, from the schema and
 * nothing else: which page and section a setting stands in, where in that
 * section, whether it is drawn right now, what its control offers, and the
 * line drawn under its label are the entry's own answers. A page component that decided any of it for itself would
 * be a second record of the same fact, and the two would drift. What the
 * section may add is a choice's faces, read at run time from what the
 * schema cannot know, such as the account's own picture.
 */
export function SchemaSettingRows({
  page,
  section = SETTING_SECTION.MAIN,
  view,
  faces,
}: {
  page: (typeof SCHEMA_SETTINGS_PAGE)[keyof typeof SCHEMA_SETTINGS_PAGE];
  section?: SettingSection;
  view: SettingsRowsInput;
  /** What each of a choice's options shows beside its words, by the setting it stores and its token; none where its options are words alone. */
  faces?: ((field: AppSettingField, token: string) => React.ReactNode) | undefined;
}): React.JSX.Element {
  const rows = settingRowsForPage(page, section, view).flatMap((row) => {
    const { field, entry, changed, control } = row;
    if (entry.kind === APP_SETTING_KIND.TOGGLE) {
      return [
        <SchemaToggleRow
          key={entry.id}
          id={entry.id}
          field={field}
          label={entry.label}
          detail={entry.detail}
          changed={changed}
          checked={entry.value === APP_TOGGLE_VALUE.ON}
        />,
      ];
    }
    if (entry.kind !== APP_SETTING_KIND.CHOICE || !control) return [];
    return [
      <SchemaChoiceRow
        key={entry.id}
        id={entry.id}
        field={field}
        view={view}
        label={entry.label}
        detail={entry.detail}
        changed={changed}
        value={control.value}
        options={control.options}
        search={control.search}
        faces={faces === undefined ? undefined : (token) => faces(field, token)}
      />,
    ];
  });
  return <>{rows}</>;
}
