import type { ProductSettingValue } from "@repo/features/analytics";
import type { UnparsedWireValue } from "@repo/wire";
import type { AppSettingId, DescribedSetting } from "@repo/wire/app-settings";
import type { HostCapability } from "./capabilities.js";
import type { ExperimentChoices } from "./experiments.js";

export const SETTINGS_PAGE = {
  ACCOUNT: "account",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  MEMORY: "memory",
  AGENTS: "agents",
  HOSTS: "hosts",
  INTEGRATIONS: "integrations",
  MCP: "mcp",
  CLI: "cli",
  SKILLS: "skills",
  WORKSPACE: "workspace",
  THIS_MAC: "this-mac",
  EXPERIMENTAL: "experimental",
  ABOUT: "about",
} as const;

export type SettingsPage = (typeof SETTINGS_PAGE)[keyof typeof SETTINGS_PAGE];

export const SETTING_SECTION = {
  MAIN: "main",
  DIFF: "diff",
  LINES: "lines",
  TEXT: "text",
  LINKS: "links",
  TASKS: "tasks",
  PRIVACY: "privacy",
  STARTUP: "startup",
  MICROPHONE: "microphone",
  COMPOSER: "composer",
  COMMITS: "commits",
} as const;

export type SettingSection = (typeof SETTING_SECTION)[keyof typeof SETTING_SECTION];

export const SETTINGS_RESET_SCOPE = {
  APPEARANCE: "appearance",
} as const;

export type SettingsResetScope = (typeof SETTINGS_RESET_SCOPE)[keyof typeof SETTINGS_RESET_SCOPE];

export const SETTING_SIDE_EFFECT = {
  NONE: "none",
  LOGIN_ITEM: "login-item",
  USAGE_DATA: "usage-data",
} as const;

export type SettingSideEffectId = (typeof SETTING_SIDE_EFFECT)[keyof typeof SETTING_SIDE_EFFECT];

export const SETTING_ROWS = {
  SCHEMA: "schema",
  BESPOKE: "bespoke",
} as const;

type SettingRows = (typeof SETTING_ROWS)[keyof typeof SETTING_ROWS];

export type StoredSettingValue = string | number | boolean | undefined;

export type AppSettingReader = (field: string) => StoredSettingValue;

export interface SettingGuardResult<Value> {
  valid: boolean;
  value: Value;
}

export interface SettingsVisibility {
  settings: { experiments: ExperimentChoices };
  accountDrawn: boolean;
  capabilities: readonly HostCapability[];
}

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingControl<Value> {
  value: (stored: Value) => string;
  search?: string | undefined;
  options: (view: SettingsVisibility) => readonly SettingOption[];
  stored: (token: string, view: SettingsVisibility) => Value | undefined;
}

export interface AppSettingSchemaEntry<
  Field extends string = string,
  Value = unknown,
  Id extends AppSettingId = AppSettingId,
  Default extends Value = Value,
> {
  readonly field: Field;
  readonly default: Default;
  readonly guard: (value: UnparsedWireValue) => SettingGuardResult<Value>;
  readonly page: SettingsPage;
  readonly section: SettingSection;
  readonly order: number;
  readonly resetScope?: SettingsResetScope | undefined;
  readonly sideEffect: SettingSideEffectId;
  readonly rows: SettingRows;
  readonly ids: readonly Id[];
  readonly describe: (
    settings: AppSettingReader,
  ) => DescribedSetting | readonly DescribedSetting[] | undefined;
  readonly visible?: ((view: SettingsVisibility) => boolean) | undefined;
  readonly control?: SettingControl<Value> | undefined;
  readonly analytics?: { readonly value: (value: StoredSettingValue) => ProductSettingValue };
}
