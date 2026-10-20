import type { ProductSettingValue } from "@luke/features/analytics";
import { isRecord, isWireString, type UnparsedWireValue } from "@luke/wire";
import type { AppSettingId, DescribedSetting } from "@luke/wire/app-settings";
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

/**
 * Every stored field, in the order its schema entry claims. The order is the
 * entries' own `order` rather than the object literal's, because a formatter or
 * a merge can reorder a literal and neither the search's list nor a page's
 * rows may move with it.
 */
export const APP_SETTING_FIELDS = Object.keys(APP_SETTING_SCHEMA)
  .filter((field): field is AppSettingField => field in APP_SETTING_SCHEMA)
  .sort((left, right) => APP_SETTING_SCHEMA[left].order - APP_SETTING_SCHEMA[right].order);

export function isAppSettingField(value: UnparsedWireValue): value is AppSettingField {
  return isWireString(value) && value in APP_SETTING_SCHEMA;
}

/**
 * Account preferences are the settings an account carries across its Macs and
 * the web. Machine-local controls — the theme, the zoom, launch at login,
 * display layout, hotkeys, microphone routing, and credentials — stay in each
 * device's own store.
 */
export const ACCOUNT_PREFERENCE_FIELDS = [
  APP_SETTING_SCHEMA.voice.field,
  APP_SETTING_SCHEMA.linkOpen.field,
] as const satisfies readonly AppSettingField[];

export type AccountPreferenceField = (typeof ACCOUNT_PREFERENCE_FIELDS)[number];

export type AccountPreferences = Partial<Pick<StoredAppSettings, AccountPreferenceField>>;

/**
 * The preferences the snapshot's shared `preferences` part carries, which a
 * write replaces whole. Note that `linkOpen` rides a part of its own beside
 * it, because a build from before it reads this part and writes it back
 * whole: a choice inside it would be refused by the older reader and cleared
 * by the older writer.
 */
const SHARED_PREFERENCE_FIELDS = [
  APP_SETTING_SCHEMA.voice.field,
] as const satisfies readonly AccountPreferenceField[];

const ACCOUNT_PREFERENCE_FIELD_SET: ReadonlySet<string> = new Set(ACCOUNT_PREFERENCE_FIELDS);

const SHARED_PREFERENCE_FIELD_SET: ReadonlySet<string> = new Set(SHARED_PREFERENCE_FIELDS);

/** The snapshot's own part for where the account's Luke links open. */
const LINK_OPEN_PART = APP_SETTING_SCHEMA.linkOpen.field;

/**
 * The preferences a record holds, each read by its own setting's guard.
 * A key outside `fields` is passed over wherever it comes from, so a
 * preference a build newer than this one adds costs this one none of the
 * others. Builds before this rule do not pass it over: v0.18.0's reader
 * refuses the whole of a wire record that names a key it does not know, so
 * the shared part keeps to the keys that build reads, and a new preference
 * rides a part of its own (`account-preferences.test.ts` pins the list). A
 * known key holding what its guard refuses is passed over in a stored
 * record, and refuses the whole of a wire one, which a client or the
 * service sent wrong.
 */
function parseAccountPreferences(
  value: UnparsedWireValue,
  fields: ReadonlySet<string>,
  source: "stored" | "wire",
): AccountPreferences | undefined {
  if (!isRecord(value)) return undefined;
  const preferences: Record<string, UnparsedWireValue> = {};
  for (const [field, rawValue] of Object.entries(value)) {
    if (!fields.has(field) || !isAppSettingField(field)) continue;
    const wireValue = rawValue === null ? undefined : rawValue;
    const parsed = APP_SETTING_SCHEMA[field].guard(wireValue);
    if (!parsed.valid) {
      if (source === "wire") return undefined;
      continue;
    }
    // SAFETY: The account-preference guard accepted this value as that setting's stored JSON shape.
    const parsedValue = parsed.value as UnparsedWireValue;
    if (parsedValue !== undefined) {
      preferences[field] = parsedValue;
    }
  }
  // SAFETY: Every key is an account preference field and every value passed that field's guard.
  return preferences as AccountPreferences;
}

/** The snapshot's shared `preferences` part as a client or the service sent it; nothing where a value in it is refused. */
export function accountPreferencesFromWire(
  value: UnparsedWireValue,
): AccountPreferences | undefined {
  return parseAccountPreferences(value, SHARED_PREFERENCE_FIELD_SET, "wire");
}

export function accountPreferencesFromStored(
  value: UnparsedWireValue,
): AccountPreferences | undefined {
  return parseAccountPreferences(value, ACCOUNT_PREFERENCE_FIELD_SET, "stored");
}

/** Where the account's links open, as a write's own part names it; nothing where it names no choice. */
export function linkOpenFromWire(value: UnparsedWireValue): AccountPreferences["linkOpen"] {
  const parsed = APP_SETTING_SCHEMA.linkOpen.guard(value);
  return parsed.valid ? parsed.value : undefined;
}

/**
 * The parts of the snapshot an account's preferences travel in: the shared
 * part, and the link choice's own where one is held. A device that never
 * chose sends no link part, so it cannot clear another device's choice.
 */
export interface AccountPreferencesParts {
  preferences: AccountPreferences;
  linkOpen?: NonNullable<AccountPreferences["linkOpen"]>;
}

/** An account's preferences split into the parts of the snapshot that carry them. */
export function accountPreferencesParts(preferences: AccountPreferences): AccountPreferencesParts {
  const { [LINK_OPEN_PART]: linkOpen, ...shared } = preferences;
  return { preferences: shared, ...(linkOpen === undefined ? undefined : { linkOpen }) };
}

/**
 * An account's preferences joined from the snapshot's parts: nothing where
 * the shared part is refused, and the link part passed over where it names
 * no choice this build knows, since a newer service's choice must not cost
 * this device the voice beside it.
 */
export function accountPreferencesFromParts(
  snapshot: Record<string, UnparsedWireValue>,
): AccountPreferences | undefined {
  const shared = accountPreferencesFromWire(snapshot.preferences);
  if (shared === undefined) return undefined;
  const linkOpen = linkOpenFromWire(snapshot[LINK_OPEN_PART]);
  return { ...shared, ...(linkOpen === undefined ? undefined : { [LINK_OPEN_PART]: linkOpen }) };
}

/**
 * The preferences a snapshot stands for, as a device merges them over its
 * own. Note that the shared part counts only once written (`updatedAt`): a
 * device takes no unwritten shared part over its own, so its own shared
 * preferences stand in for it. The link part is written apart and never
 * cleared on the service, only chosen again, so one the snapshot holds is
 * taken either way, and a choice made on the web reaches a Mac before any
 * voice was synced; one it lacks was never written by anyone, so the
 * device's own stands in for it, and a first choice made before the first
 * sync is kept to be written rather than merged away.
 */
export function snapshotAccountPreferences(
  remote: AccountPreferences,
  sharedWritten: boolean,
  local: AccountPreferences,
): AccountPreferences {
  const remoteParts = accountPreferencesParts(remote);
  const localParts = accountPreferencesParts(local);
  const shared = sharedWritten ? remoteParts.preferences : localParts.preferences;
  const linkOpen = remoteParts.linkOpen ?? localParts.linkOpen;
  return { ...shared, ...(linkOpen === undefined ? undefined : { [LINK_OPEN_PART]: linkOpen }) };
}

/**
 * What a device writes of its preferences. A link choice it held when it
 * last synced and has since cleared is written as the default, since a
 * write without the link part leaves the service's choice standing, and the
 * next sync would bring back the choice the device let go of; one it never
 * held is left out, so it clears no other device's.
 */
export function accountPreferencesToWrite(
  local: AccountPreferences,
  baseline: AccountPreferences | undefined,
): AccountPreferences {
  const cleared = local[LINK_OPEN_PART] === undefined && baseline?.[LINK_OPEN_PART] !== undefined;
  return cleared ? { ...local, [LINK_OPEN_PART]: APP_SETTING_SCHEMA.linkOpen.default } : local;
}

/**
 * What a device pushes as one of its own preferences changes: what it
 * writes, less a link choice it has not changed since it last synced, since
 * the service may hold a newer one another device made meanwhile, which a
 * push of the voice beside it must not put back.
 */
export function accountPreferencesToPush(
  local: AccountPreferences,
  baseline: AccountPreferences | undefined,
): AccountPreferences {
  const written = accountPreferencesToWrite(local, baseline);
  if (written[LINK_OPEN_PART] !== baseline?.[LINK_OPEN_PART]) return written;
  const { [LINK_OPEN_PART]: _unchanged, ...rest } = written;
  return rest;
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
    // SAFETY: Every stored value is one of the runtime families a guard answers in.
    return settings[field] as StoredSettingValue;
  };
}

/** Every setting's description as the settings stand, in schema order: the settings search's corpus. */
export function describedSettings(
  settings: Pick<StoredAppSettings, AppSettingField>,
): DescribedSetting[] {
  const read = settingReader(settings);
  return APP_SETTING_FIELDS.flatMap((field) => [...descriptionsFor(field, read)]);
}

/** Whether a field's row is drawn right now. A field that declares no condition is always drawn. */
function settingVisible(field: AppSettingField, view: SettingsVisibility): boolean {
  return APP_SETTING_SCHEMA[field].visible?.(view) ?? true;
}

/** Whether the row one setting id names is drawn right now. */
export function settingIdVisible(id: string, view: SettingsVisibility): boolean {
  const field = settingFieldForId(id);
  return field !== undefined && settingVisible(field, view);
}

/**
 * What the settings pages and the settings search are both read from: the
 * settings as they stand, and the facts a row's own condition is judged from.
 * One record, so a result can never lead to a page without its row.
 */
export interface SettingsRowsInput extends SettingsVisibility {
  /** The settings as they stand, and the experiments the account has on, which decide whether a gated feature's rows stand. */
  settings: Pick<StoredAppSettings, AppSettingField> &
    RuntimeStatus & {
      experiments: ExperimentChoices;
    };
}

/** One row of a settings page, as the panel's own schema renderer draws it. */
interface SchemaSettingRow {
  field: AppSettingField;
  /** The setting as it describes itself now: its words and its value. */
  entry: DescribedSetting;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed: boolean;
  /** The pop-up's own current token and options, for a choice row. */
  control?: { value: string; options: readonly SettingOption[]; search?: string | undefined };
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

/** What a counted setting change reports: which setting, and the shape of its new value. */
interface SettingAnalytics {
  id: AppSettingId;
  value: ProductSettingValue;
}

/**
 * How a change to this field is counted, or nothing for a field the schema
 * does not count. The value itself never travels — only whether a switch went
 * on or off, or whether a choice was made or returned to nothing. The id is the
 * field's first, because a change rides one stored write however many
 * descriptions it builds.
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
