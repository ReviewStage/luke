import { PRODUCT_SETTING_VALUE, type ProductSettingValue } from "@luke/features/analytics";
import type { UnparsedWireValue } from "@luke/wire";
import { APP_SETTING_KIND, type AppSettingId, appToggleText } from "@luke/wire/app-settings";
import { Result, Schema } from "effect";
import {
  type AppSettingReader,
  type AppSettingSchemaEntry,
  SETTING_ROWS,
  SETTING_SECTION,
  type SettingControl,
  type SettingGuardResult,
  type SettingOption,
  type SettingSection,
  type SettingSideEffectId,
  type SettingsPage,
  type SettingsResetScope,
  type SettingsVisibility,
  type StoredSettingValue,
} from "./schema-types.js";

const valid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: true, value });
const invalid = <Value>(value: Value): SettingGuardResult<Value> => ({ valid: false, value });

/**
 * Every guard settles as a `Result` before it ever becomes a `{ valid, value
 * }` pair: a success is what a guard accepted, and a failure carries the same
 * value a caller sees on refusal (the default, or `undefined`), because the
 * exported shape keeps a value on both branches even where the failure
 * channel usually would not. The fold is total, so it is stated as one —
 * `Result.match` rather than a test of the tag and a reach into the arm it
 * proved.
 */
const settingGuardFromEither = <Value>(
  either: Result.Result<Value, Value>,
): SettingGuardResult<Value> => Result.match(either, { onSuccess: valid, onFailure: invalid });

export function optional<Value extends UnparsedWireValue>(
  value: UnparsedWireValue,
  guard: (candidate: UnparsedWireValue) => candidate is Value,
): SettingGuardResult<Value | undefined> {
  if (value === undefined) return valid(undefined);
  return settingGuardFromEither(guard(value) ? Result.succeed(value) : Result.fail(undefined));
}

function boolean(defaultValue: boolean) {
  const isBoolean = Schema.is(Schema.Boolean);
  return (value: UnparsedWireValue): SettingGuardResult<boolean> =>
    settingGuardFromEither(isBoolean(value) ? Result.succeed(value) : Result.fail(defaultValue));
}

const toggleAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF;

const choiceAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === undefined ? PRODUCT_SETTING_VALUE.CLEARED : PRODUCT_SETTING_VALUE.SET;

/**
 * A stored on/off. That it is a toggle is what fixes its guard, its
 * description's kind and words for its two states, and the shape a change is
 * counted in, so a toggle declares only what is its own.
 */
export function toggleSetting<Field extends string, Id extends AppSettingId>(spec: {
  field: Field;
  id: Id;
  label: string;
  /** What the row cannot say for itself, drawn under its label. */
  detail?: string;
  default: boolean;
  page: SettingsPage;
  section?: SettingSection;
  order: number;
  sideEffect: SettingSideEffectId;
  resetScope?: SettingsResetScope;
  visible?: (view: SettingsVisibility) => boolean;
}): AppSettingSchemaEntry<Field, boolean, Id, boolean> {
  return {
    field: spec.field,
    default: spec.default,
    guard: boolean(spec.default),
    page: spec.page,
    section: spec.section ?? SETTING_SECTION.MAIN,
    order: spec.order,
    resetScope: spec.resetScope,
    sideEffect: spec.sideEffect,
    rows: SETTING_ROWS.SCHEMA,
    ids: [spec.id],
    describe: (settings) => ({
      id: spec.id,
      label: spec.label,
      ...(spec.detail === undefined ? undefined : { detail: spec.detail }),
      kind: APP_SETTING_KIND.TOGGLE,
      value: appToggleText(settings(spec.field) === true),
    }),
    visible: spec.visible,
    analytics: { value: toggleAnalytics },
  };
}

/**
 * A stored one-of. `values` is the stored vocabulary and `token` is the word
 * the control stores each by — also what it shows, unless `optionLabel` words
 * it differently, which is the difference between "marin" as a token and
 * "Marin (default)" on a pop-up. `absent` is the word for no choice at all,
 * for a setting whose default is nothing.
 */
export function choiceSetting<
  Field extends string,
  Value extends string | number,
  Id extends AppSettingId,
  Default extends Value | undefined,
>(spec: {
  field: Field;
  id: Id;
  label: string;
  /** What the row cannot say for itself, drawn under its label. */
  detail?: string;
  /** Every value the setting stores, in the order the control offers them. */
  values: readonly Value[];
  /** The control's token for a value, and the value its description reads. */
  token: (value: Value) => string;
  /** How a value is worded on the control, when that differs from `token`. */
  optionLabel?: (value: Value) => string;
  /** The address of the picture a value is shown with, for a choice whose values have faces, which is then chosen from them. */
  optionPicture?: (value: Value) => string | undefined;
  /** The path of the clip a value is heard in, under the panel's asset base, for a choice whose values are sounds. */
  optionSample?: (value: Value) => string | undefined;
  /** The heading a value stands under, for a choice drawn in groups; values sharing one stand together in `values`' order. */
  optionGroup?: (value: Value) => string | undefined;
  /** A short word of what a value is, at the end of its row where the control draws one. */
  optionTag?: (value: Value) => string | undefined;
  default: Default;
  /** The word for no choice at all, required where the default is nothing. */
  absent?: string;
  page: SettingsPage;
  section?: SettingSection;
  order: number;
  sideEffect: SettingSideEffectId;
  resetScope?: SettingsResetScope;
  /**
   * The vocabulary's own guard for its own values. Passed rather than built
   * from `values`, because the package that names a value set is the package
   * that says what one is, and a membership test rebuilt here would be a
   * second reading of it.
   */
  guard: (value: UnparsedWireValue) => SettingGuardResult<Value | undefined>;
  visible?: (view: SettingsVisibility) => boolean;
  /** A control whose options are observed, or whose empty token is its own. */
  control?: SettingControl<Value | undefined>;
  /** The empty search field's words, for a list long enough that its pop-up searches. */
  search?: string;
}): AppSettingSchemaEntry<Field, Value | undefined, Id, Default> {
  const optionLabel = spec.optionLabel ?? spec.token;
  const byToken: Map<string, Value> = new Map(
    spec.values.map((value) => [spec.token(value), value] as const),
  );
  const storedValue = (read: AppSettingReader): Value | undefined => {
    const value = read(spec.field);
    if (value === undefined) return undefined;
    // SAFETY: The field's own guard is what put this value in the store.
    return value as Value;
  };
  // A choice with a default says the default where nothing is stored; one with
  // no default needs a word for nothing, and `schema.test.ts` refuses an entry
  // that would read as blank rather than letting it draw one.
  const tokenOf = (value: Value | undefined): string => {
    if (value !== undefined) return spec.token(value);
    if (spec.absent !== undefined) return spec.absent;
    return spec.default === undefined ? "" : spec.token(spec.default);
  };
  const control: SettingControl<Value | undefined> = spec.control ?? {
    value: (stored) => tokenOf(stored),
    search: spec.search,
    options: (): readonly SettingOption[] =>
      spec.values.map((value) => {
        const picture = spec.optionPicture?.(value);
        const sample = spec.optionSample?.(value);
        const group = spec.optionGroup?.(value);
        const tag = spec.optionTag?.(value);
        return {
          value: spec.token(value),
          label: optionLabel(value),
          ...(picture === undefined ? undefined : { picture }),
          ...(sample === undefined ? undefined : { sample }),
          ...(group === undefined ? undefined : { group }),
          ...(tag === undefined ? undefined : { tag }),
        };
      }),
    stored: (token) => byToken.get(token),
  };
  return {
    field: spec.field,
    default: spec.default,
    guard: spec.guard,
    page: spec.page,
    section: spec.section ?? SETTING_SECTION.MAIN,
    order: spec.order,
    resetScope: spec.resetScope,
    sideEffect: spec.sideEffect,
    rows: SETTING_ROWS.SCHEMA,
    ids: [spec.id],
    describe: (settings) => ({
      id: spec.id,
      label: spec.label,
      ...(spec.detail === undefined ? undefined : { detail: spec.detail }),
      kind: APP_SETTING_KIND.CHOICE,
      value: tokenOf(storedValue(settings)),
    }),
    visible: spec.visible,
    control,
    analytics: { value: choiceAnalytics },
  };
}
