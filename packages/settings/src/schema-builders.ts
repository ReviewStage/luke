import { PRODUCT_SETTING_VALUE, type ProductSettingValue } from "@repo/features/analytics";
import type { UnparsedWireValue } from "@repo/wire";
import { APP_SETTING_KIND, type AppSettingId, appToggleText } from "@repo/wire/app-settings";
import { Schema } from "effect";
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

export function optional<Value extends UnparsedWireValue>(
  value: UnparsedWireValue,
  guard: (candidate: UnparsedWireValue) => candidate is Value,
): SettingGuardResult<Value | undefined> {
  if (value === undefined) return valid(undefined);
  return guard(value) ? valid(value) : invalid(undefined);
}

function boolean(defaultValue: boolean) {
  const isBoolean = Schema.is(Schema.Boolean);
  return (value: UnparsedWireValue): SettingGuardResult<boolean> =>
    isBoolean(value) ? valid(value) : invalid(defaultValue);
}

const toggleAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF;

const choiceAnalytics = (value: StoredSettingValue): ProductSettingValue =>
  value === undefined ? PRODUCT_SETTING_VALUE.CLEARED : PRODUCT_SETTING_VALUE.SET;

type SettingKind = (typeof APP_SETTING_KIND)[keyof typeof APP_SETTING_KIND];

interface RowSpec<Field extends string, Id extends AppSettingId> {
  field: Field;
  id: Id;
  label: string;
  detail?: string | ((settings: AppSettingReader) => string);
  page: SettingsPage;
  section?: SettingSection;
  order: number;
  sideEffect: SettingSideEffectId;
  resetScope?: SettingsResetScope;
  visible?: (view: SettingsVisibility) => boolean;
}

interface ToggleSpec<Field extends string, Id extends AppSettingId> extends RowSpec<Field, Id> {
  default: boolean;
}

function rowEntry<Field extends string, Id extends AppSettingId>(
  spec: RowSpec<Field, Id>,
  kind: SettingKind,
  value: (settings: AppSettingReader) => string,
): Pick<
  AppSettingSchemaEntry<Field, unknown, Id>,
  | "field"
  | "page"
  | "section"
  | "order"
  | "resetScope"
  | "sideEffect"
  | "rows"
  | "ids"
  | "describe"
  | "visible"
> {
  return {
    field: spec.field,
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
      ...(spec.detail === undefined
        ? undefined
        : { detail: typeof spec.detail === "string" ? spec.detail : spec.detail(settings) }),
      kind,
      value: value(settings),
    }),
    visible: spec.visible,
  };
}

function toggleEntry<Field extends string, Id extends AppSettingId>(
  spec: ToggleSpec<Field, Id>,
): Omit<AppSettingSchemaEntry<Field, boolean, Id, boolean>, "guard" | "control"> {
  return {
    ...rowEntry(spec, APP_SETTING_KIND.TOGGLE, (settings) =>
      appToggleText(settings(spec.field) === true),
    ),
    default: spec.default,
    analytics: { value: toggleAnalytics },
  };
}

export function toggleSetting<Field extends string, Id extends AppSettingId>(
  spec: ToggleSpec<Field, Id>,
): AppSettingSchemaEntry<Field, boolean, Id, boolean> {
  return { ...toggleEntry(spec), guard: boolean(spec.default) };
}

export function buildToggleSetting<Field extends string, Id extends AppSettingId>(
  spec: ToggleSpec<Field, Id> & { unpackagedDefault: boolean },
): AppSettingSchemaEntry<Field, boolean | undefined, Id, boolean> & {
  readonly unpackagedDefault: boolean;
} {
  const isBoolean = Schema.is(Schema.Boolean);
  return {
    ...toggleEntry(spec),
    guard: (value: UnparsedWireValue) => optional(value, isBoolean),
    unpackagedDefault: spec.unpackagedDefault,
  };
}

export function accountToggleSetting<Field extends string, Id extends AppSettingId>(
  spec: ToggleSpec<Field, Id>,
): AppSettingSchemaEntry<Field, boolean | undefined, Id, boolean> {
  const isBoolean = Schema.is(Schema.Boolean);
  return { ...toggleEntry(spec), guard: (value: UnparsedWireValue) => optional(value, isBoolean) };
}

export function accountHiddenSetting<
  Field extends string,
  Value extends string,
  Id extends AppSettingId,
>(spec: {
  field: Field;
  id: Id;
  page: SettingsPage;
  order: number;
  sideEffect: SettingSideEffectId;
  guard: (value: UnparsedWireValue) => value is Value;
}): AppSettingSchemaEntry<Field, Value | undefined, Id, undefined> {
  return {
    field: spec.field,
    default: undefined,
    guard: (value: UnparsedWireValue) => optional(value, spec.guard),
    page: spec.page,
    section: SETTING_SECTION.MAIN,
    order: spec.order,
    sideEffect: spec.sideEffect,
    rows: SETTING_ROWS.SCHEMA,
    ids: [spec.id],
    describe: () => undefined,
    visible: () => false,
  };
}

export function choiceSetting<
  Field extends string,
  Value extends string | number,
  Id extends AppSettingId,
  Default extends Value | undefined,
>(
  spec: RowSpec<Field, Id> & {
    values: readonly Value[];
    token: (value: Value) => string;
    optionLabel?: (value: Value) => string;
    default: Default;
    absent?: string;
    guard: (value: UnparsedWireValue) => SettingGuardResult<Value | undefined>;
    control?: SettingControl<Value | undefined>;
    search?: string;
  },
): AppSettingSchemaEntry<Field, Value | undefined, Id, Default> {
  const optionLabel = spec.optionLabel ?? spec.token;
  const byToken: Map<string, Value> = new Map(
    spec.values.map((value) => [spec.token(value), value] as const),
  );
  const storedValue = (read: AppSettingReader): Value | undefined => {
    const value = read(spec.field);
    if (value === undefined) return undefined;
    return value as Value;
  };
  const tokenOf = (value: Value | undefined): string => {
    if (value !== undefined) return spec.token(value);
    if (spec.absent !== undefined) return spec.absent;
    return spec.default === undefined ? "" : spec.token(spec.default);
  };
  const control: SettingControl<Value | undefined> = spec.control ?? {
    value: (stored) => tokenOf(stored),
    search: spec.search,
    options: (): readonly SettingOption[] =>
      spec.values.map((value) => ({ value: spec.token(value), label: optionLabel(value) })),
    stored: (token) => byToken.get(token),
  };
  return {
    ...rowEntry(spec, APP_SETTING_KIND.CHOICE, (settings) => tokenOf(storedValue(settings))),
    default: spec.default,
    guard: spec.guard,
    control,
    analytics: { value: choiceAnalytics },
  };
}
