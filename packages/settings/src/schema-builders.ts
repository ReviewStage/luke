import { PRODUCT_SETTING_VALUE, type ProductSettingValue } from "@sidecar/analytics";
import { APP_SETTING_KIND, type AppSettingId, appToggleText } from "@sidecar/guide";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Result, Schema } from "effect";
import {
  type AppSettingReader,
  type AppSettingSchemaEntry,
  SETTING_ROWS,
  SETTING_SECTION,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
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
import { parseVoiceHotkey, VOICE_HOTKEY_NONE } from "./voice-hotkey.js";

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

function hotkey(value: UnparsedWireValue): SettingGuardResult<string | undefined> {
  if (value === undefined) return valid(undefined);
  if (!isWireString(value)) return settingGuardFromEither(Result.fail(undefined));
  // A deletion is a choice the parser cannot spell: no chord at all, with no
  // default standing in behind the absence.
  if (value === VOICE_HOTKEY_NONE) return settingGuardFromEither(Result.succeed(VOICE_HOTKEY_NONE));
  const parsed = parseVoiceHotkey(value);
  return settingGuardFromEither(parsed ? Result.succeed(parsed) : Result.fail(undefined));
}

const toggleAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF;

const choiceAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === undefined ? PRODUCT_SETTING_VALUE.CLEARED : PRODUCT_SETTING_VALUE.SET;

// A deleted key counts as off rather than set: a stored value stands either
// way, and the count is the one reader of the difference. The chord itself
// never travels, whichever shape is reported.
const hotkeyAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === VOICE_HOTKEY_NONE ? PRODUCT_SETTING_VALUE.OFF : choiceAnalytics(value);

/**
 * A stored on/off. That it is a toggle is what fixes its guard, its
 * description's kind and words for its two states, and the shape a change is
 * counted in, so a toggle declares only what is its own.
 */
export function toggleSetting<Field extends string, Id extends AppSettingId>(spec: {
  field: Field;
  id: Id;
  label: string;
  description: string;
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
      description: spec.description,
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
  description: string;
  /** Every value the setting stores, in the order the control offers them. */
  values: readonly Value[];
  /** The control's token for a value, and the value its description reads. */
  token: (value: Value) => string;
  /** How a value is worded on the control, when that differs from `token`. */
  optionLabel?: (value: Value) => string;
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
    options: (): readonly SettingOption[] =>
      spec.values.map((value) => ({ value: spec.token(value), label: optionLabel(value) })),
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
      description: spec.description,
      kind: APP_SETTING_KIND.CHOICE,
      value: tokenOf(storedValue(settings)),
    }),
    visible: spec.visible,
    control,
    analytics: { value: choiceAnalytics },
  };
}

/**
 * A stored chord. Every hotkey is the same setting three times: the same
 * guard, the same reading for a count — a deleted key counts as off — and no
 * description, because the Shortcuts page draws the registered chord by hand
 * rather than as a schema row. The id is listed all the same, so the chord's
 * page is named and a change to it can be counted.
 */
export function hotkeySetting<Field extends string, Id extends AppSettingId>(spec: {
  field: Field;
  id: Id;
  order: number;
  sideEffect: SettingSideEffectId;
}): AppSettingSchemaEntry<Field, string | undefined, Id, undefined> {
  return {
    field: spec.field,
    default: undefined,
    guard: hotkey,
    page: SETTINGS_PAGE.SHORTCUTS,
    section: SETTING_SECTION.MAIN,
    order: spec.order,
    resetScope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    sideEffect: spec.sideEffect,
    rows: SETTING_ROWS.BESPOKE,
    ids: [spec.id],
    describe: () => undefined,
    analytics: { value: hotkeyAnalytics },
  };
}
