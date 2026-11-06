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

type SettingOption = NonNullable<
  ReturnType<typeof settingRowsForPage>[number]["control"]
>["options"][number];

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
  faces: ((token: string) => React.ReactNode) | undefined;
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
      parse={(token) =>
        token !== value && options.some((option) => option.value === token) ? token : undefined
      }
      placeholder={search}
      {...(isAppSettingId(id) ? { anchor: id } : undefined)}
      write={write}
    />
  );
}

export function SchemaSettingRows({
  page,
  section = SETTING_SECTION.MAIN,
  view,
  faces,
}: {
  page: (typeof SCHEMA_SETTINGS_PAGE)[keyof typeof SCHEMA_SETTINGS_PAGE];
  section?: SettingSection;
  view: SettingsRowsInput;
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
