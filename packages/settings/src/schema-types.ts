import type { ProductSettingValue } from "@sidecar/analytics";
import type { AppSettingId, DescribedSetting } from "@sidecar/guide";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { RuntimeStatus } from "./status.js";

export const SETTINGS_PAGE = {
  ROOT: "root",
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  /** The coding agents' default model and effort, which are the account's on the service rather than a stored setting. */
  CODING_AGENTS: "coding-agents",
} as const;

export type SettingsPage = (typeof SETTINGS_PAGE)[keyof typeof SETTINGS_PAGE];

/**
 * Which run of rows inside a page draws a setting. A page is not always one
 * list: the Voice page draws its controls below the permission that lets Luke
 * listen, and a setting has to say which run it stands in rather than leave
 * the section to pick its own members.
 */
export const SETTING_SECTION = {
  /** The page's own plain run of rows, for a page that has only one. */
  MAIN: "main",
  /** The voice controls, below the permission that lets Luke listen. */
  CONTROLS: "controls",
} as const;

export type SettingSection = (typeof SETTING_SECTION)[keyof typeof SETTING_SECTION];

export const SETTINGS_RESET_SCOPE = {
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
} as const;

export type SettingsResetScope = (typeof SETTINGS_RESET_SCOPE)[keyof typeof SETTINGS_RESET_SCOPE];

/**
 * Which side effect a write to a setting runs. It names an effect rather than
 * holding one: the host and the client each keep a table over the whole of this
 * set, so an id added here does not build until both sides say what it does.
 */
export const SETTING_SIDE_EFFECT = {
  NONE: "none",
  LOGIN_ITEM: "login-item",
  VOICE: "voice",
  TALK_HOTKEY: "talk-hotkey",
  STOP_HOTKEY: "stop-hotkey",
  MEDIA_DUCK: "media-duck",
} as const;

export type SettingSideEffectId = (typeof SETTING_SIDE_EFFECT)[keyof typeof SETTING_SIDE_EFFECT];

/** Who draws a field's row. */
export const SETTING_ROWS = {
  /** `SchemaSettingRows` draws it, from this entry alone. */
  SCHEMA: "schema",
  /** A named component draws it, because its control is not a switch or a pop-up. */
  BESPOKE: "bespoke",
} as const;

type SettingRows = (typeof SETTING_ROWS)[keyof typeof SETTING_ROWS];

/** The concrete runtime families a stored setting may use after its schema guard. */
export type StoredSettingValue = string | number | boolean | undefined;

/** How a description reads the settings as they stand, field by field. */
export type AppSettingReader = (field: string) => StoredSettingValue;

export interface SettingGuardResult<Value> {
  valid: boolean;
  value: Value;
}

/**
 * What a row's visibility and its dynamic options may be judged from: the
 * settings themselves, and the few facts about the surface around them that
 * decide whether a row stands at all. One record, read by the panel to decide
 * what to draw and by the settings search to decide what to offer, so a result
 * can no longer lead to a page without its row.
 */
export interface SettingsVisibility {
  /** The runtime facts a row's own condition is judged from. */
  settings: RuntimeStatus;
  /**
   * Voice available and the microphone granted: until both, the Voice page
   * holds only the way in.
   */
  voiceControlsDrawn: boolean;
  /** Whether the Account section stands. */
  accountDrawn: boolean;
}

/** One option a row's control draws: the token it stores by, and the words it shows. */
export interface SettingOption {
  value: string;
  label: string;
}

/**
 * What a choice row's control offers, for a choice its own values cannot
 * stand in for: options observed rather than fixed by the build, or a
 * token for no choice at all that no stored value could collide with. The three
 * halves are one declaration because they are one statement about one row — a
 * token the options offered is a token the parse has to answer for.
 */
export interface SettingControl<Value> {
  /** The token the control draws for the value stored now. */
  value: (stored: Value) => string;
  options: (view: SettingsVisibility) => readonly SettingOption[];
  /** What one of those tokens means as a stored value; nothing means cleared. */
  stored: (token: string, view: SettingsVisibility) => Value | undefined;
}

/**
 * One stored setting, declared once. Everything about it that any consumer
 * needs is here: the store reads `default` and `guard`, the panel reads `page`,
 * `section`, `order`, `rows`, `visible`, `control`, and `describe`, the
 * settings search reads `ids` and `describe`, the host's and the client's
 * side-effect tables are keyed by `sideEffect`, and the counter reads
 * `analytics`. There is no second record of any of it, and no `switch`
 * anywhere over which setting this is.
 */
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
  /**
   * Where in its section it stands, ascending. An explicit number because the
   * order rows are drawn in was the order of an object literal, which a
   * formatter, a merge, or an alphabetizing lint rule can silently change.
   */
  readonly order: number;
  readonly resetScope?: SettingsResetScope | undefined;
  readonly sideEffect: SettingSideEffectId;
  readonly rows: SettingRows;
  /** The setting ids this one field is named by. */
  readonly ids: readonly Id[];
  /** The descriptions it builds, or none for a field whose row is drawn by hand. */
  readonly describe: (
    settings: AppSettingReader,
  ) => DescribedSetting | readonly DescribedSetting[] | undefined;
  /** Whether its row is drawn right now. Absent means always drawn. */
  readonly visible?: ((view: SettingsVisibility) => boolean) | undefined;
  readonly control?: SettingControl<Value> | undefined;
  /**
   * How a change to it is counted. The id is derived: a change rides one
   * stored write, and `ids[0]` is the id that write is counted under.
   */
  readonly analytics?: { readonly value: (value: StoredSettingValue) => ProductSettingValue };
}
