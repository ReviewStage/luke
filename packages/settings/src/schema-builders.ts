import { PRODUCT_SETTING_VALUE, type ProductSettingValue } from "@sidecar/analytics";
import {
  APP_SETTING_KIND,
  APP_TOGGLE_VALUE,
  type AppSettingId,
  appToggleText,
} from "@sidecar/guide";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Either, Schema } from "effect";
import {
  type AppSettingGuideSettings,
  type AppSettingSchemaEntry,
  SETTING_ROWS,
  SETTING_SECTION,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  type SettingControl,
  type SettingEntryDefinition,
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
 * Every guard settles as an `Either` before it ever becomes a `{ valid, value
 * }` pair: a `Right` is what a guard accepted, and a `Left` carries the same
 * value a caller sees on refusal (the default, or `undefined`), because the
 * exported shape keeps a value on both branches even where the failure
 * channel usually would not.
 */
export const settingGuardFromEither = <Value>(
  either: Either.Either<Value, Value>,
): SettingGuardResult<Value> =>
  Either.isRight(either) ? valid(either.right) : invalid(either.left);

export function optional<Value extends UnparsedWireValue>(
  value: UnparsedWireValue,
  guard: (candidate: UnparsedWireValue) => candidate is Value,
): SettingGuardResult<Value | undefined> {
  if (value === undefined) return valid(undefined);
  return settingGuardFromEither(guard(value) ? Either.right(value) : Either.left(undefined));
}

function boolean(defaultValue: boolean) {
  const isBoolean = Schema.is(Schema.Boolean);
  return (value: UnparsedWireValue): SettingGuardResult<boolean> =>
    settingGuardFromEither(isBoolean(value) ? Either.right(value) : Either.left(defaultValue));
}

function hotkey(value: UnparsedWireValue): SettingGuardResult<string | undefined> {
  if (value === undefined) return valid(undefined);
  if (!isWireString(value)) return settingGuardFromEither(Either.left(undefined));
  // A deletion is a choice the parser cannot spell: no chord at all, with no
  // default standing in behind the absence.
  if (value === VOICE_HOTKEY_NONE) return settingGuardFromEither(Either.right(VOICE_HOTKEY_NONE));
  const parsed = parseVoiceHotkey(value);
  return settingGuardFromEither(parsed ? Either.right(parsed) : Either.left(undefined));
}

const toggleAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF;

export const choiceAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === undefined ? PRODUCT_SETTING_VALUE.CLEARED : PRODUCT_SETTING_VALUE.SET;

// A deleted key counts as off rather than set: a stored value stands either
// way, and the count is the one reader of the difference. The chord itself
// never travels, whichever shape is reported.
const hotkeyAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === VOICE_HOTKEY_NONE ? PRODUCT_SETTING_VALUE.OFF : choiceAnalytics(value);

/**
 * A hand-written entry, for the few settings no builder answers for: a map
 * whose keys are observed, or view state the pages draw no row for at all.
 * An identity function, so the entry is checked against the contract where it
 * is written rather than where it is read.
 */
export function storedSetting<
  Field extends string,
  Value,
  Id extends AppSettingId,
  Default extends Value,
>(
  entry: AppSettingSchemaEntry<Field, Value, Id, Default>,
): AppSettingSchemaEntry<Field, Value, Id, Default> {
  return entry;
}

/**
 * A hand-written entry whose value is a map, so the store can write one of its
 * keys at a time. The entry definition rides on the return type rather than the
 * shared contract, because it is what `KeyedAppSettingField` is derived from:
 * an optional member of every entry would make every field a keyed one.
 */
export function keyedSetting<
  Field extends string,
  Value,
  Id extends AppSettingId,
  Default extends Value,
  Entry extends SettingEntryDefinition<never>,
>(
  entry: AppSettingSchemaEntry<Field, Value, Id, Default> & { entry: Entry },
): AppSettingSchemaEntry<Field, Value, Id, Default> & { entry: Entry } {
  return entry;
}

/**
 * A stored on/off. That it is a toggle is what fixes its guard, its guide
 * entry's kind and words for its two states, the shape a change is counted in,
 * and how a spoken `on` or `off` reads back, so a toggle declares only what is
 * its own.
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
  /** Where the same change is made by hand. */
  manual: string;
  sideEffect: SettingSideEffectId;
  resetScope?: SettingsResetScope;
  /** False for a switch a spoken ask may not flip; the refusal is the guidance. */
  adjustable: boolean;
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
    guide: (settings) => ({
      id: spec.id,
      label: spec.label,
      description: spec.description,
      kind: APP_SETTING_KIND.TOGGLE,
      value: appToggleText(settings(spec.field) === true),
      defaultValue: appToggleText(spec.default),
      adjustable: spec.adjustable,
      manual: spec.manual,
    }),
    visible: spec.visible,
    spokenValue: (value: string) => value === APP_TOGGLE_VALUE.ON,
    analytics: { value: toggleAnalytics },
  };
}

/**
 * A stored one-of. `values` is the stored vocabulary and `say` is how each is
 * said — aloud and on the control alike, unless `optionLabel` words the control
 * differently, which is the difference between "normal" in a sentence and
 * "1× (default)" on a pop-up. `absent` is the word for no choice at all, for a
 * setting whose default is nothing.
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
  /** Every value the setting stores, in the order the guide and control offer them. */
  values: readonly Value[];
  /** How a value is said in the guide and understood from a spoken ask. */
  say: (value: Value) => string;
  /** How a value is worded on the control, when that differs from `say`. */
  optionLabel?: (value: Value) => string;
  /** Extra spellings a spoken ask may use, each meaning one value. */
  alias?: Readonly<Record<string, Value>>;
  /** The words the guide offers, when they are not simply every value said. */
  choices?: readonly string[];
  default: Default;
  /** The word for no choice at all, required where the default is nothing. */
  absent?: string;
  page: SettingsPage;
  section?: SettingSection;
  order: number;
  manual: string;
  sideEffect: SettingSideEffectId;
  resetScope?: SettingsResetScope;
  rows?: typeof SETTING_ROWS.SCHEMA | typeof SETTING_ROWS.BESPOKE;
  adjustable: boolean;
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
  const optionLabel = spec.optionLabel ?? spec.say;
  const spoken: Map<string, Value> = new Map([
    ...spec.values.map((value) => [spec.say(value), value] as const),
    ...Object.entries(spec.alias ?? {}),
  ]);
  const storedValue = (read: AppSettingGuideSettings): Value | undefined => {
    const value = read(spec.field);
    if (value === undefined) return undefined;
    // SAFETY: The field's own guard is what put this value in the store.
    return value as Value;
  };
  // A choice with a default says the default where nothing is stored; one with
  // no default needs a word for nothing, and `schema.test.ts` refuses an entry
  // that would read as blank rather than letting it draw one.
  const said = (value: Value | undefined): string => {
    if (value !== undefined) return spec.say(value);
    if (spec.absent !== undefined) return spec.absent;
    return spec.default === undefined ? "" : spec.say(spec.default);
  };
  const control: SettingControl<Value | undefined> = spec.control ?? {
    value: (stored) => said(stored),
    options: (): readonly SettingOption[] =>
      spec.values.map((value) => ({ value: spec.say(value), label: optionLabel(value) })),
    stored: (token) => spoken.get(token),
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
    rows: spec.rows ?? SETTING_ROWS.SCHEMA,
    ids: [spec.id],
    guide: (settings) => ({
      id: spec.id,
      label: spec.label,
      description: spec.description,
      kind: APP_SETTING_KIND.CHOICE,
      value: said(storedValue(settings)),
      defaultValue: said(spec.default),
      choices: spec.choices ?? spec.values.map(spec.say),
      adjustable: spec.adjustable,
      manual: spec.manual,
    }),
    visible: spec.visible,
    control,
    // A choice no spoken ask may change needs no word to read back: the
    // refusal Luke voices is the whole of what it offers.
    spokenValue: spec.adjustable ? (value: string) => spoken.get(value) : undefined,
    analytics: { value: choiceAnalytics },
  };
}

/**
 * A stored chord. Every hotkey is the same setting three times: the same
 * guard, the same reading for a count — a deleted key counts as off — and the
 * same empty guide entry, because the key's own fact reports the registered
 * chord and its manual path rather than the stored choice. The id is listed
 * all the same, so the chord's page is named and a change to it can be
 * counted. A chord is never spoken, so none of them parses one.
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
    guide: () => undefined,
    analytics: { value: hotkeyAnalytics },
  };
}
