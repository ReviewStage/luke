import type { ProductSettingValue } from "@repo/features/analytics";
import { isRecord, isWireString, type UnparsedWireValue } from "@repo/wire";
import type { AppSettingId, DescribedSetting } from "@repo/wire/app-settings";
import { Schema } from "effect";
import type { ExperimentChoices } from "./experiments.js";
import { APP_SETTING_SCHEMA } from "./schema.js";
import type {
  AppSettingReader,
  SettingControl,
  SettingGuardResult,
  SettingOption,
  SettingSection,
  SettingsPage,
  SettingsResetScope,
  SettingsVisibility,
  StoredSettingValue,
} from "./schema-types.js";
import { SETTING_ROWS, SETTINGS_RESET_SCOPE } from "./schema-types.js";

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

export const APP_SETTING_FIELDS = Object.keys(APP_SETTING_SCHEMA)
  .filter((field): field is AppSettingField => field in APP_SETTING_SCHEMA)
  .sort((left, right) => APP_SETTING_SCHEMA[left].order - APP_SETTING_SCHEMA[right].order);

export function isAppSettingField(value: UnparsedWireValue): value is AppSettingField {
  return isWireString(value) && value in APP_SETTING_SCHEMA;
}

export const ACCOUNT_PREFERENCE_FIELDS = [
  APP_SETTING_SCHEMA.linkOpen.field,
  APP_SETTING_SCHEMA.agentEnter.field,
  APP_SETTING_SCHEMA.commitAuthor.field,
  APP_SETTING_SCHEMA.setupFinished.field,
  APP_SETTING_SCHEMA.setupPlace.field,
] as const satisfies readonly AppSettingField[];

export type AccountPreferenceField = (typeof ACCOUNT_PREFERENCE_FIELDS)[number];

export type AccountPreferences = Partial<Pick<StoredAppSettings, AccountPreferenceField>>;

const SHARED_PREFERENCE_FIELDS = [] as const satisfies readonly AccountPreferenceField[];

const ACCOUNT_PREFERENCE_FIELD_SET: ReadonlySet<string> = new Set(ACCOUNT_PREFERENCE_FIELDS);

const SHARED_PREFERENCE_FIELD_SET: ReadonlySet<string> = new Set(SHARED_PREFERENCE_FIELDS);

const OWN_PART_FIELDS = [
  APP_SETTING_SCHEMA.linkOpen.field,
  APP_SETTING_SCHEMA.agentEnter.field,
  APP_SETTING_SCHEMA.commitAuthor.field,
  APP_SETTING_SCHEMA.setupFinished.field,
  APP_SETTING_SCHEMA.setupPlace.field,
] as const satisfies readonly AccountPreferenceField[];

type OwnPartField = (typeof OWN_PART_FIELDS)[number];

const PREFERENCE_SOURCE = {
  STORED: "stored",
  WIRE: "wire",
} as const;

type PreferenceSource = (typeof PREFERENCE_SOURCE)[keyof typeof PREFERENCE_SOURCE];

function parseAccountPreferences(
  value: UnparsedWireValue,
  fields: ReadonlySet<string>,
  source: PreferenceSource,
): AccountPreferences | undefined {
  if (!isRecord(value)) return undefined;
  const preferences: Record<string, UnparsedWireValue> = {};
  for (const [field, rawValue] of Object.entries(value)) {
    if (!fields.has(field) || !isAppSettingField(field)) continue;
    const wireValue = rawValue === null ? undefined : rawValue;
    const parsed = APP_SETTING_SCHEMA[field].guard(wireValue);
    if (!parsed.valid) {
      if (source === PREFERENCE_SOURCE.WIRE) return undefined;
      continue;
    }
    const parsedValue = parsed.value as UnparsedWireValue;
    if (parsedValue !== undefined) {
      preferences[field] = parsedValue;
    }
  }
  return preferences as AccountPreferences;
}

export function accountPreferencesFromWire(
  value: UnparsedWireValue,
): AccountPreferences | undefined {
  return parseAccountPreferences(value, SHARED_PREFERENCE_FIELD_SET, PREFERENCE_SOURCE.WIRE);
}

export function accountPreferencesFromStored(
  value: UnparsedWireValue,
): AccountPreferences | undefined {
  return parseAccountPreferences(value, ACCOUNT_PREFERENCE_FIELD_SET, PREFERENCE_SOURCE.STORED);
}

export function ownPreferenceFromWire<Field extends OwnPartField>(
  field: Field,
  value: UnparsedWireValue,
): AccountPreferences[Field] {
  const parsed = APP_SETTING_SCHEMA[field].guard(value);
  return (parsed.valid ? parsed.value : undefined) as AccountPreferences[Field];
}

export type AccountPreferencesParts = { preferences: AccountPreferences } & {
  [Field in OwnPartField]?: NonNullable<AccountPreferences[Field]>;
};

function ownChoices(record: Partial<Record<OwnPartField, UnparsedWireValue>>): AccountPreferences {
  const chosen: Record<string, UnparsedWireValue> = {};
  for (const field of OWN_PART_FIELDS) {
    if (record[field] !== undefined) chosen[field] = record[field];
  }
  return chosen as AccountPreferences;
}

function sharedOf(preferences: AccountPreferences): AccountPreferences {
  const shared: Record<string, UnparsedWireValue> = { ...preferences };
  for (const field of OWN_PART_FIELDS) delete shared[field];
  return shared as AccountPreferences;
}

export function accountPreferencesParts(preferences: AccountPreferences): AccountPreferencesParts {
  return {
    preferences: sharedOf(preferences),
    ...ownChoices(preferences),
  } as AccountPreferencesParts;
}

export function accountPreferencesFromParts(
  snapshot: Record<string, UnparsedWireValue>,
): AccountPreferences | undefined {
  const shared = accountPreferencesFromWire(snapshot.preferences);
  if (shared === undefined) return undefined;
  const owned: Record<string, UnparsedWireValue> = {};
  for (const field of OWN_PART_FIELDS) owned[field] = ownPreferenceFromWire(field, snapshot[field]);
  return { ...shared, ...ownChoices(owned) };
}

export function snapshotAccountPreferences(
  remote: AccountPreferences,
  sharedWritten: boolean,
  local: AccountPreferences,
): AccountPreferences {
  const shared = sharedWritten ? sharedOf(remote) : sharedOf(local);
  return { ...shared, ...ownChoices(local), ...ownChoices(remote) };
}

export function accountPreferencesToWrite(
  local: AccountPreferences,
  baseline: AccountPreferences | undefined,
): AccountPreferences {
  const written: Record<string, UnparsedWireValue> = { ...local };
  for (const field of OWN_PART_FIELDS) {
    if (local[field] === undefined && baseline?.[field] !== undefined) {
      written[field] = APP_SETTING_SCHEMA[field].default;
    }
  }
  return written as AccountPreferences;
}

export function accountPreferencesToPush(
  local: AccountPreferences,
  baseline: AccountPreferences | undefined,
): AccountPreferences {
  const written: Record<string, UnparsedWireValue> = {
    ...accountPreferencesToWrite(local, baseline),
  };
  for (const field of OWN_PART_FIELDS) {
    if (written[field] === baseline?.[field]) delete written[field];
  }
  return written as AccountPreferences;
}

const SettingsResetScopeSchema = Schema.Literals(Object.values(SETTINGS_RESET_SCOPE));

const readsSettingsResetScope = Schema.is(SettingsResetScopeSchema);

export function isSettingsResetScope(value: UnparsedWireValue): value is SettingsResetScope {
  return readsSettingsResetScope(value);
}

export function settingFieldForId(id: string): AppSettingField | undefined {
  return APP_SETTING_FIELDS.find((field) =>
    APP_SETTING_SCHEMA[field].ids.some((candidate) => candidate === id),
  );
}

function isDescribedSettingList(
  value: DescribedSetting | readonly DescribedSetting[],
): value is readonly DescribedSetting[] {
  return Array.isArray(value);
}

function descriptionsFor(
  field: AppSettingField,
  read: AppSettingReader,
): readonly DescribedSetting[] {
  const built = APP_SETTING_SCHEMA[field].describe(read);
  if (built === undefined) return [];
  return isDescribedSettingList(built) ? built : [built];
}

function settingReader(settings: Pick<StoredAppSettings, AppSettingField>): AppSettingReader {
  return (field) => {
    if (!isAppSettingField(field)) return undefined;
    return settings[field] as StoredSettingValue;
  };
}

export function describedSettings(
  settings: Pick<StoredAppSettings, AppSettingField>,
): DescribedSetting[] {
  const read = settingReader(settings);
  return APP_SETTING_FIELDS.flatMap((field) => [...descriptionsFor(field, read)]);
}

export function settingVisible(field: AppSettingField, view: SettingsVisibility): boolean {
  return APP_SETTING_SCHEMA[field].visible?.(view) ?? true;
}

export function settingIdVisible(id: string, view: SettingsVisibility): boolean {
  const field = settingFieldForId(id);
  return field !== undefined && settingVisible(field, view);
}

export interface SettingsRowsInput extends SettingsVisibility {
  settings: Pick<StoredAppSettings, AppSettingField> & { experiments: ExperimentChoices };
}

interface SchemaSettingRow {
  field: AppSettingField;
  entry: DescribedSetting;
  changed: boolean;
  control?: { value: string; options: readonly SettingOption[]; search?: string | undefined };
}

function settingControl(field: AppSettingField): SettingControl<StoredSettingValue> | undefined {
  return APP_SETTING_SCHEMA[field].control as SettingControl<StoredSettingValue> | undefined;
}

export function settingRowsForPage(
  page: SettingsPage,
  section: SettingSection,
  view: SettingsRowsInput,
): readonly SchemaSettingRow[] {
  const read = settingReader(view.settings);
  return APP_SETTING_FIELDS.flatMap((field): SchemaSettingRow[] => {
    const definition = APP_SETTING_SCHEMA[field];
    if (definition.rows !== SETTING_ROWS.SCHEMA) return [];
    if (definition.page !== page || definition.section !== section) return [];
    if (!settingVisible(field, view)) return [];
    const control = settingControl(field);
    const stored = view.settings[field];
    return descriptionsFor(field, read).map((entry) => ({
      field,
      entry,
      changed: stored !== definition.default,
      ...(control
        ? {
            control: {
              value: control.value(stored),
              options: control.options(view),
              search: control.search,
            },
          }
        : undefined),
    }));
  });
}

export function settingFromOption<Field extends AppSettingField>(
  field: Field,
  token: string,
  view: SettingsVisibility,
): AppSettingValue<Field> | undefined {
  return settingControl(field)?.stored(token, view) as AppSettingValue<Field> | undefined;
}

interface SettingAnalytics {
  id: AppSettingId;
  value: ProductSettingValue;
}

export function settingAnalytics(
  field: AppSettingField,
  settings: Pick<StoredAppSettings, AppSettingField>,
): SettingAnalytics | undefined {
  const definition = APP_SETTING_SCHEMA[field];
  const id = definition.ids[0];
  if (!definition.analytics || id === undefined) return undefined;
  return { id, value: definition.analytics.value(settings[field] as StoredSettingValue) };
}

const appSettingDefaults = Object.fromEntries(
  APP_SETTING_FIELDS.map((field) => [field, APP_SETTING_SCHEMA[field].default]),
);
type AppSettingDefaults = {
  readonly [Field in AppSettingField]: (typeof APP_SETTING_SCHEMA)[Field]["default"];
};

function typedAppSettingDefaults(): AppSettingDefaults {
  return appSettingDefaults as AppSettingDefaults;
}

export const APP_SETTING_DEFAULTS = typedAppSettingDefaults();

export function settingsScopeChanged(
  settings: Pick<StoredAppSettings, AppSettingField>,
  scope: SettingsResetScope,
  view: SettingsVisibility,
): boolean {
  return APP_SETTING_FIELDS.some((field) => {
    const definition = APP_SETTING_SCHEMA[field];
    if (definition.resetScope !== scope) return false;
    if (!settingVisible(field, view)) return false;
    return settings[field] !== definition.default;
  });
}
