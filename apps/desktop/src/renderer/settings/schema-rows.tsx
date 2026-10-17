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
import { SELECT_ALIGN, Select, SettingsRow, Switch } from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { APP_SETTING_KIND, APP_TOGGLE_VALUE } from "@luke/wire/app-settings";
import { ACTOR_SIZE, PictureMark } from "../actor-ref";
import { ChangedMark } from "./marks";
import { Picker } from "./picker-row";
import type { SettingsWrites } from "./writes";

/** One value a choice's control offers, as the schema hands it. */
type SettingOption = NonNullable<
  ReturnType<typeof settingRowsForPage>[number]["control"]
>["options"][number];

/** What the menu says when a search over a choice's values matches nothing. */
const NO_MATCH = "Nothing matches.";

/** A row's name, with the word it wears while its value differs from the default. */
function rowLabel(label: string, changed: boolean): React.ReactNode {
  return (
    <>
      {label}
      {changed ? <ChangedMark /> : null}
    </>
  );
}

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
  const { busy, rejection, run } = useSettingWrite(onChange);
  return (
    <SettingsRow label={rowLabel(label, changed)} description={detail} error={rejection}>
      {(control) => (
        <Switch
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
 * A choice's row: the shared row, and the shared pop-up for a short set read
 * whole. A set long enough to search, or whose values have faces, drops the
 * window's searchable menu instead (`picker-row.tsx`), which the pop-up is not.
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
  const { busy, rejection, run } = useSettingWrite(onChange);
  const pictured = options.some((option) => option.picture !== undefined);
  // A token the set does not hold is not written, so a stale menu writes nothing.
  const pick = (token: string) => {
    if (options.some((option) => option.value === token)) run(token);
  };
  return (
    <SettingsRow label={rowLabel(label, changed)} description={detail} error={rejection}>
      {(control) =>
        search === undefined && !pictured ? (
          <Select
            {...anchorOf(id)}
            label={label}
            options={options}
            value={value}
            describedBy={control["aria-describedby"]}
            disabled={busy}
            align={SELECT_ALIGN.END}
            onChange={pick}
          />
        ) : (
          <SearchedChoice
            id={id}
            label={label}
            describedBy={control["aria-describedby"]}
            value={value}
            options={options}
            search={search}
            disabled={busy}
            onPick={pick}
          />
        )
      }
    </SettingsRow>
  );
}

/** A choice's chip over the window's searchable menu, a face on every value where the set has faces. */
function SearchedChoice({
  id,
  label,
  describedBy,
  value,
  options,
  search,
  disabled,
  onPick,
}: {
  id: string;
  label: string;
  describedBy: string | undefined;
  value: string;
  options: readonly SettingOption[];
  search: string | undefined;
  disabled: boolean;
  onPick: (token: string) => void;
}): React.JSX.Element {
  const chosen = options.find((option) => option.value === value);
  const pictured = options.some((option) => option.picture !== undefined);
  const face = (option: SettingOption, size: typeof ACTOR_SIZE.INLINE | typeof ACTOR_SIZE.ROW) => (
    <PictureMark id={option.value} name={option.label} pictureUrl={option.picture} size={size} />
  );
  return (
    <Picker
      label={label}
      describedBy={describedBy}
      value={value}
      valueLabel={chosen?.label ?? value}
      valueIcon={pictured && chosen !== undefined ? face(chosen, ACTOR_SIZE.INLINE) : undefined}
      // A set with faces draws one on every row, its letter where it has no picture.
      rows={options.map((option) => ({
        id: option.value,
        label: option.label,
        ...(pictured ? { icon: face(option, ACTOR_SIZE.ROW) } : undefined),
      }))}
      placeholder={search}
      noMatch={NO_MATCH}
      anchor={isAppSettingId(id) ? id : undefined}
      disabled={disabled}
      onPick={onPick}
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
