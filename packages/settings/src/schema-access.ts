import type { ProductSettingValue } from "@sidecar/analytics";
import { APP_SETTING_ID, type AppGuideSetting, type AppSettingId } from "@sidecar/guide";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { APP_SETTING_SCHEMA } from "./schema.js";
import type {
  AppSettingGuideSettings,
  SettingControl,
  SettingEntryDefinition,
  SettingGuardResult,
  SettingOption,
  SettingSection,
  SettingsPage,
  SettingsResetScope,
  SettingsVisibility,
  StoredSettingValue,
} from "./schema-types.js";
import { SETTING_ROWS, SETTINGS_PAGE, SETTINGS_RESET_SCOPE } from "./schema-types.js";
import type { RuntimeStatus } from "./status.js";

type GuardValue<Definition> = Definition extends {
  guard(value: UnparsedWireValue): SettingGuardResult<infer Value>;
}
  ? Value
  : never;

export type AppSettingField = keyof typeof APP_SETTING_SCHEMA;
export type AppSettingValue<Field extends AppSettingField> = GuardValue<
  (typeof APP_SETTING_SCHEMA)[Field]
>;
export type StoredAppSettings = {
  [Field in AppSettingField as undefined extends AppSettingValue<Field>
    ? never
    : Field]: AppSettingValue<Field>;
} & {
  [Field in AppSettingField as undefined extends AppSettingValue<Field>
    ? Field
    : never]?: AppSettingValue<Field>;
};

/** What one key of a map-valued setting holds. */
export type SettingEntryValue<Field extends AppSettingField> = NonNullable<
  NonNullable<AppSettingValue<Field>>[keyof NonNullable<AppSettingValue<Field>>]
>;

/**
 * Every stored field, in the order its schema entry claims. The order is the
 * entries' own `order` rather than the object literal's, because a formatter or
 * a merge can reorder a literal and neither the guide's list nor a page's rows
 * may move with it.
 */
export const APP_SETTING_FIELDS = Object.keys(APP_SETTING_SCHEMA)
  .filter((field): field is AppSettingField => field in APP_SETTING_SCHEMA)
  .sort((left, right) => APP_SETTING_SCHEMA[left].order - APP_SETTING_SCHEMA[right].order);

export function isAppSettingField(value: UnparsedWireValue): value is AppSettingField {
  return isWireString(value) && value in APP_SETTING_SCHEMA;
}

/**
 * Account preferences are the settings shared by desktop, phone, and watch.
 * Machine-local controls — launch at login, Dock, display layout, hotkeys,
 * microphone routing, local list filters, credentials, and calendar grants —
 * stay in each device's own store.
 */
export const ACCOUNT_PREFERENCE_FIELDS = [
  APP_SETTING_SCHEMA.voice.field,
  APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
  APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
  APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
] as const satisfies readonly AppSettingField[];

export type AccountPreferenceField = (typeof ACCOUNT_PREFERENCE_FIELDS)[number];
export type AccountPreferences = Partial<Pick<StoredAppSettings, AccountPreferenceField>>;

const ACCOUNT_PREFERENCE_FIELD_SET: ReadonlySet<string> = new Set(ACCOUNT_PREFERENCE_FIELDS);

function isAccountPreferenceField(value: UnparsedWireValue): value is AccountPreferenceField {
  return isWireString(value) && ACCOUNT_PREFERENCE_FIELD_SET.has(value);
}

function accountPreferenceDroppedMapEntries(
  field: AccountPreferenceField,
  rawValue: UnparsedWireValue,
  parsedValue: UnparsedWireValue,
): boolean {
  if (
    (field !== APP_SETTING_SCHEMA.workspaceProjectDefaults.field &&
      field !== APP_SETTING_SCHEMA.workspaceAgentDefaults.field) ||
    !isRecord(rawValue)
  ) {
    return false;
  }
  const rawCount = Object.keys(rawValue).length;
  if (rawCount === 0) return false;
  return !isRecord(parsedValue) || Object.keys(parsedValue).length !== rawCount;
}

function parseAccountPreferences(
  value: UnparsedWireValue,
  source: "stored" | "wire",
): AccountPreferences | undefined {
  if (!isRecord(value)) return undefined;
  const preferences: Record<string, UnparsedWireValue> = {};
  for (const [field, rawValue] of Object.entries(value)) {
    if (!isAccountPreferenceField(field)) {
      if (source === "wire") return undefined;
      continue;
    }
    const wireValue = rawValue === null ? undefined : rawValue;
    const parsed = APP_SETTING_SCHEMA[field].guard(wireValue);
    if (!parsed.valid) {
      if (source === "wire") return undefined;
      continue;
    }
    // SAFETY: The account-preference guard accepted this value as that setting's stored JSON shape.
    const parsedValue = parsed.value as UnparsedWireValue;
    if (
      source === "wire" &&
      wireValue !== undefined &&
      accountPreferenceDroppedMapEntries(field, wireValue, parsedValue)
    ) {
      return undefined;
    }
    if (parsedValue !== undefined) {
      preferences[field] = parsedValue;
    }
  }
  // SAFETY: Every key came from ACCOUNT_PREFERENCE_FIELDS and every value passed that field's guard.
  return preferences as AccountPreferences;
}

export function accountPreferencesFromWire(
  value: UnparsedWireValue,
): AccountPreferences | undefined {
  return parseAccountPreferences(value, "wire");
}

export function accountPreferencesFromStored(
  value: UnparsedWireValue,
): AccountPreferences | undefined {
  return parseAccountPreferences(value, "stored");
}

/** The settings whose value is a map, and so can be written one entry at a time. */
export type KeyedAppSettingField = {
  [Field in AppSettingField]: "entry" extends keyof (typeof APP_SETTING_SCHEMA)[Field]
    ? Field
    : never;
}[AppSettingField];

export function isKeyedAppSettingField(value: UnparsedWireValue): value is KeyedAppSettingField {
  return isAppSettingField(value) && "entry" in APP_SETTING_SCHEMA[value];
}

function settingEntry(field: KeyedAppSettingField): SettingEntryDefinition<never> {
  // SAFETY: KeyedAppSettingField is derived only from schema members that declare `entry`.
  return (APP_SETTING_SCHEMA[field] as { entry: SettingEntryDefinition<never> }).entry;
}

export function isSettingEntryKey(
  field: KeyedAppSettingField,
  key: UnparsedWireValue,
): key is string {
  return settingEntry(field).isKey(key);
}

export function sameSettingEntry(
  field: KeyedAppSettingField,
  current: UnparsedWireValue,
  next: UnparsedWireValue,
): boolean {
  // SAFETY: The selected entry definition owns both values; `never` erases the keyed union.
  return settingEntry(field).same(current as never, next as never);
}

/**
 * Validates one entry by running the field's own whole-map guard over a map
 * holding only that entry: an entry the guard drops is one the map would have
 * dropped, so the two readings of what is valid cannot drift apart. Clearing an
 * entry carries no value to check.
 */
export function settingEntryGuard(
  field: KeyedAppSettingField,
  key: string,
  value: UnparsedWireValue,
): SettingGuardResult<unknown> {
  if (value === undefined) return { valid: true, value: undefined };
  const parsed = APP_SETTING_SCHEMA[field].guard({ [key]: value });
  // SAFETY: The guard validated the map; indexing recovers the single entry under test.
  const kept = parsed.valid ? (parsed.value as WireRecord | undefined)?.[key] : undefined;
  return kept === undefined ? { valid: false, value: undefined } : { valid: true, value: kept };
}

export function isSettingsResetScope(value: UnparsedWireValue): value is SettingsResetScope {
  return Object.values(SETTINGS_RESET_SCOPE).some((scope) => scope === value);
}

export function settingFieldForGuideId(id: string): AppSettingField | undefined {
  return APP_SETTING_FIELDS.find((field) =>
    APP_SETTING_SCHEMA[field].ids.some((candidate) => candidate === id),
  );
}

function isGuideSettingList(
  value: AppGuideSetting | readonly AppGuideSetting[],
): value is readonly AppGuideSetting[] {
  return Array.isArray(value);
}

function guideEntriesFor(
  field: AppSettingField,
  read: AppSettingGuideSettings,
): readonly AppGuideSetting[] {
  const built = APP_SETTING_SCHEMA[field].guide(read);
  if (built === undefined) return [];
  return isGuideSettingList(built) ? built : [built];
}

function guideReader(settings: Pick<StoredAppSettings, AppSettingField>): AppSettingGuideSettings {
  return (field) => {
    if (!isAppSettingField(field)) return undefined;
    // SAFETY: Every stored value is one of the runtime families a guard answers in.
    return settings[field] as StoredSettingValue;
  };
}

export function settingGuideEntries(
  settings: Pick<StoredAppSettings, AppSettingField>,
): AppGuideSetting[] {
  const read = guideReader(settings);
  return APP_SETTING_FIELDS.flatMap((field) => [...guideEntriesFor(field, read)]);
}

/**
 * Whether a field's row is drawn right now. A field that declares no condition
 * is always drawn; one whose entries answer to conditions of their own is asked
 * per id instead.
 */
export function settingVisible(field: AppSettingField, view: SettingsVisibility): boolean {
  return APP_SETTING_SCHEMA[field].visible?.(view) ?? true;
}

/** Whether the row one guide id names is drawn right now. */
export function settingIdVisible(id: string, view: SettingsVisibility): boolean {
  const field = settingFieldForGuideId(id);
  if (!field) return false;
  if (!settingVisible(field, view)) return false;
  // SAFETY: The table is keyed by the field's own ids, of which this is one.
  const byId = APP_SETTING_SCHEMA[field].visibleById as
    | Readonly<Partial<Record<string, (view: SettingsVisibility) => boolean>>>
    | undefined;
  return byId?.[id]?.(view) ?? true;
}

/**
 * What the settings pages and the settings search are both read from: the
 * settings as they stand, and the facts a row's own condition is judged from.
 * One record, so a result can never lead to a page without its row.
 */
export interface SettingsRowsInput extends SettingsVisibility {
  settings: Pick<StoredAppSettings, AppSettingField> & RuntimeStatus;
}

/** One row of a settings page, as the panel's own schema renderer draws it. */
export interface SchemaSettingRow {
  field: AppSettingField;
  /** The setting as the guide describes it now: its words, its value, its choices. */
  entry: AppGuideSetting;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed: boolean;
  /** The pop-up's own current token and options, for a choice row. */
  control?: { value: string; options: readonly SettingOption[] };
}

/**
 * One field's control, read at the one width every field's shares: every stored
 * value is a `StoredSettingValue`, and which one it is the field already says.
 */
function settingControl(field: AppSettingField): SettingControl<StoredSettingValue> | undefined {
  // SAFETY: The control belongs to the field selected, whose stored type this widens to.
  return APP_SETTING_SCHEMA[field].control as SettingControl<StoredSettingValue> | undefined;
}

/**
 * Every row one section of one page draws, in the order its entries claim. The
 * schema is the whole answer: which page, which section, whether the row stands
 * right now, and what its control offers — so a page component has no list of
 * fields of its own to drift from this one.
 */
export function settingRowsForPage(
  page: SettingsPage,
  section: SettingSection,
  view: SettingsRowsInput,
): readonly SchemaSettingRow[] {
  const read = guideReader(view.settings);
  return APP_SETTING_FIELDS.flatMap((field): SchemaSettingRow[] => {
    const definition = APP_SETTING_SCHEMA[field];
    if (definition.rows !== SETTING_ROWS.SCHEMA) return [];
    if (definition.page !== page || definition.section !== section) return [];
    if (!settingVisible(field, view)) return [];
    const control = settingControl(field);
    const stored = view.settings[field];
    return guideEntriesFor(field, read).map((entry) => ({
      field,
      entry,
      changed: stored !== definition.default,
      ...(control
        ? {
            control: { value: control.value(stored), options: control.options(view) },
          }
        : undefined),
    }));
  });
}

/**
 * What one of a row's own option tokens means as a stored value, for the choice
 * rows whose options the control declares. Nothing means the choice is cleared.
 */
export function settingFromOption<Field extends AppSettingField>(
  field: Field,
  token: string,
  view: SettingsVisibility,
): AppSettingValue<Field> | undefined {
  // SAFETY: The control belongs to the field selected, so its stored type is that field's.
  return settingControl(field)?.stored(token, view) as AppSettingValue<Field> | undefined;
}

export function spokenSettingValue<Field extends AppSettingField>(
  field: Field,
  value: string,
): AppSettingValue<Field> | undefined {
  // SAFETY: spokenValue answers in the stored type of the field selected.
  const convert = APP_SETTING_SCHEMA[field].spokenValue as
    | ((candidate: string) => AppSettingValue<Field> | undefined)
    | undefined;
  return convert?.(value);
}

/** What a counted setting change reports: which setting, and the shape of its new value. */
export interface SettingAnalytics {
  id: AppSettingId;
  value: ProductSettingValue;
}

/**
 * How a change to this field is counted, or nothing for a field the schema
 * does not count. The value itself never travels — only whether a switch went
 * on or off, or whether a choice was made or returned to nothing. The id is the
 * field's first, because a change rides one stored write however many entries
 * the guide builds from it.
 */
export function settingAnalytics(
  field: AppSettingField,
  settings: Pick<StoredAppSettings, AppSettingField>,
): SettingAnalytics | undefined {
  const definition = APP_SETTING_SCHEMA[field];
  const id = definition.ids[0];
  if (!definition.analytics || id === undefined) return undefined;
  // SAFETY: The reading belongs to the field selected, whose stored value this is.
  return { id, value: definition.analytics.value(settings[field] as StoredSettingValue) };
}

const appSettingDefaults = Object.fromEntries(
  APP_SETTING_FIELDS.map((field) => [field, APP_SETTING_SCHEMA[field].default]),
);
type AppSettingDefaults = {
  readonly [Field in AppSettingField]: (typeof APP_SETTING_SCHEMA)[Field]["default"];
};

function typedAppSettingDefaults(): AppSettingDefaults {
  // SAFETY: Each field is paired with the default declared by its own schema entry.
  return appSettingDefaults as AppSettingDefaults;
}

export const APP_SETTING_DEFAULTS = typedAppSettingDefaults();

export const SETTING_PAGE = {
  // SAFETY: Each entry maps one settings id to the page its schema declares;
  // the `satisfies` below is what checks the set ends up complete.
  ...(Object.fromEntries(
    Object.values(APP_SETTING_SCHEMA).flatMap((definition) =>
      definition.ids.map((id) => [id, definition.page]),
    ),
  ) as Record<AppSettingId, SettingsPage>),
  // Which calendars count is chosen on the rows themselves rather than
  // through a settings field, so it is the one id whose page cannot be
  // derived from the schema. Named here so the `Record` stays total.
  [APP_SETTING_ID.CALENDAR_SELECTED]: SETTINGS_PAGE.CONNECTIONS,
} satisfies Record<AppSettingId, SettingsPage>;

export function settingsScopeChanged(
  settings: Pick<StoredAppSettings, AppSettingField>,
  scope: SettingsResetScope,
): boolean {
  return APP_SETTING_FIELDS.some((field) => {
    const definition = APP_SETTING_SCHEMA[field];
    if (definition.resetScope !== scope) return false;
    return settings[field] !== definition.default;
  });
}
