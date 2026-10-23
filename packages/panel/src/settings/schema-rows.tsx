import {
  isAppSettingId,
  type SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingSection,
  type SettingsRowsInput,
  settingFromOption,
  settingRowsForPage,
} from "@luke/settings";
import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { SettingsRow, Switch } from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { APP_SETTING_KIND, APP_TOGGLE_VALUE } from "@luke/wire/app-settings";
import { SettingMarks } from "./marks.js";
import { PictureChoiceRow } from "./picture-choice-row.js";
import { SampledChoiceRow } from "./sampled-choice-row.js";
import { SelectRow } from "./select-row.js";
import type { SettingsWrites } from "./writes.js";

/** One value a choice's control offers, as the schema hands it. */
type SettingOption = NonNullable<
  ReturnType<typeof settingRowsForPage>[number]["control"]
>["options"][number];

/** Where a pressed search result lands: the row's one control, for a row the schema names. */
function anchorOf(id: string) {
  return isAppSettingId(id) ? searchAnchorProps(id) : undefined;
}

/**
 * A toggle's row: the shared row and switch. The write and its refusal live
 * here, so two switches can be in flight at once and a refusal stands under
 * the row that asked, in the row's own error line.
 */
function SchemaSwitchRow({
  id,
  label,
  detail,
  changed,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  detail: string | undefined;
  changed: boolean;
  checked: boolean;
  onChange: (enabled: boolean) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, saves, run } = useSettingWrite(onChange);
  return (
    <SettingsRow
      label={label}
      adornment={<SettingMarks changed={changed} saves={saves} />}
      description={detail}
      error={rejection}
      labelsControl
    >
      {(control) => (
        <Switch
          id={control.controlId}
          {...anchorOf(id)}
          checked={checked}
          label={label}
          describedBy={control["aria-describedby"]}
          aria-invalid={control["aria-invalid"]}
          disabled={busy}
          onChange={(next) => run(next)}
        />
      )}
    </SettingsRow>
  );
}

/**
 * A choice's row: the shared pop-up (`select-row.tsx`), whose menu searches
 * where the schema gives the set a search field and reads whole where it
 * does not. A set whose values have faces is a `PictureChoiceRow`, and a set
 * whose values are heard a `SampledChoiceRow`, never this.
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
      detail={detail}
      changed={changed}
      value={value}
      options={options}
      // A token the set does not hold is not written, so a stale menu writes nothing.
      parse={(token) => (options.some((option) => option.value === token) ? token : undefined)}
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
        <SchemaSwitchRow
          key={entry.id}
          id={entry.id}
          label={entry.label}
          detail={entry.detail}
          changed={changed}
          checked={entry.value === APP_TOGGLE_VALUE.ON}
          onChange={(enabled) => writes.setting(field, enabled)}
        />,
      ];
    }
    if (entry.kind !== APP_SETTING_KIND.CHOICE || !control) return [];
    // A set whose every value has a face is chosen from the faces, drawn large, rather than from a menu.
    const pictured = control.options.flatMap(({ value, label, picture }) =>
      picture === undefined ? [] : [{ value, label, picture }],
    );
    if (pictured.length > 0 && pictured.length === control.options.length) {
      return [
        <PictureChoiceRow
          key={entry.id}
          label={entry.label}
          {...(isAppSettingId(entry.id) ? { anchor: entry.id } : undefined)}
          detail={entry.detail}
          changed={changed}
          value={control.value}
          options={pictured}
          onChange={(token) => writes.setting(field, settingFromOption(field, token, view))}
        />,
      ];
    }
    // A set whose every value is heard, as the voices are, is chosen in a dialog that plays each as it is picked.
    const sampled = control.options.flatMap(({ value, label, sample, group, tag }) =>
      sample === undefined ? [] : [{ value, label, sample, group, tag }],
    );
    if (sampled.length > 0 && sampled.length === control.options.length) {
      return [
        <SampledChoiceRow
          key={entry.id}
          label={entry.label}
          {...(isAppSettingId(entry.id) ? { anchor: entry.id } : undefined)}
          detail={entry.detail}
          changed={changed}
          value={control.value}
          options={sampled}
          onChange={(token) => writes.setting(field, settingFromOption(field, token, view))}
        />,
      ];
    }
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
