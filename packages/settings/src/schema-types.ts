import type { ProductSettingValue } from "@sidecar/analytics";
import type { AppGuideSetting, AppSettingId } from "@sidecar/guide";
import type { SessionFilter, WorkspaceAgentDefaults, WorkspaceProviderId } from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { RuntimeStatus } from "./status.js";

export const SETTINGS_PAGE = {
  ROOT: "root",
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  CONNECTIONS: "connections",
} as const;

export type SettingsPage = (typeof SETTINGS_PAGE)[keyof typeof SETTINGS_PAGE];

/**
 * Which run of rows inside a page draws a setting. A page is not one list: the
 * Connections page draws its workspace choice, its key sync, its providers, and
 * its calendars under headings of their own, and a setting has to say which of
 * them it stands in rather than leave the section to pick its own members.
 */
export const SETTING_SECTION = {
  /** The page's own plain run of rows, for a page that has only one. */
  MAIN: "main",
  /** The voice controls, below the permission that lets Luke listen. */
  CONTROLS: "controls",
  /** Which credential the voice runs on, drawn by the Provider section's picker. */
  PROVIDER: "provider",
  WORKSPACES: "workspaces",
  SYNC: "sync",
  PROVIDERS: "providers",
  CALENDAR: "calendar",
} as const;

export type SettingSection = (typeof SETTING_SECTION)[keyof typeof SETTING_SECTION];

export const SETTINGS_RESET_SCOPE = {
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  WORKSPACES: "workspaces",
} as const;

export type SettingsResetScope = (typeof SETTINGS_RESET_SCOPE)[keyof typeof SETTINGS_RESET_SCOPE];

/**
 * Which side effect a write to a setting runs. It names an effect rather than
 * holding one: the host and the client each keep a table over the whole of this
 * set, so an id added here does not build until both sides say what it does.
 */
export const SETTING_SIDE_EFFECT = {
  NONE: "none",
  DOCK: "dock",
  LOGIN_ITEM: "login-item",
  DISPLAYS: "displays",
  FORM_FACTOR: "form-factor",
  VOICE: "voice",
  VOICE_SPEED: "voice-speed",
  TALK_HOTKEY: "talk-hotkey",
  ASK_HOTKEY: "ask-hotkey",
  STOP_HOTKEY: "stop-hotkey",
  MEDIA_DUCK: "media-duck",
  VOICE_SOURCE: "voice-source",
  ANNOUNCEMENT_HOLD: "announcement-hold",
  VAULT_SYNC: "vault-sync",
} as const;

export type SettingSideEffectId = (typeof SETTING_SIDE_EFFECT)[keyof typeof SETTING_SIDE_EFFECT];

/** Who draws a field's row. */
export const SETTING_ROWS = {
  /** `SchemaSettingRows` draws it, from this entry alone. */
  SCHEMA: "schema",
  /** A named component draws it, because its control is not a switch or a pop-up. */
  BESPOKE: "bespoke",
  /** Nothing draws it: it is stored view state, not a setting. */
  NONE: "none",
} as const;

export type SettingRows = (typeof SETTING_ROWS)[keyof typeof SETTING_ROWS];

/** The concrete runtime families a stored setting may use after its schema guard. */
export type StoredSettingValue =
  | string
  | number
  | boolean
  | readonly SessionFilter[]
  | WorkspaceAgentDefaults
  | Readonly<Partial<Record<WorkspaceProviderId, string>>>
  | undefined;

/** How a guide builder reads the settings as they stand, field by field. */
export type AppSettingGuideSettings = (field: string) => StoredSettingValue;

export interface SettingGuardResult<Value> {
  valid: boolean;
  value: Value;
}

/**
 * Declares a setting whose value is a map of per-key entries, so one entry can
 * be written under the store's own lock. A caller that read the map, merged an
 * entry, and wrote the whole thing back would drop any entry saved while its
 * write was in flight — the lost update `#serialize` exists to prevent.
 */
export interface SettingEntryDefinition<Value> {
  isKey(value: UnparsedWireValue): boolean;
  /** Whether the stored entry already says what a write would say. */
  same(current: Value | undefined, next: Value | undefined): boolean;
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
  /** Whether the Account section — and so the Provider section — stands. */
  accountDrawn: boolean;
  /** Superset is drawn while installed; its agent row needs a connection too. */
  superset: { installed: boolean; connected: boolean; agents: readonly string[] };
  /**
   * The providers the workspace rows may name: the ones currently offering
   * projects, plus a stored default that is not — a choice the row cannot show
   * is one that can be neither seen nor cleared. Only a provider actually
   * offering projects draws a Default project row of its own, which is what
   * `offersProjects` says.
   */
  workspaceProviders: readonly {
    id: WorkspaceProviderId;
    name: string;
    offersProjects: boolean;
  }[];
}

/** One option a row's control draws, which is not always what the guide says aloud. */
export interface SettingOption {
  value: string;
  label: string;
}

/**
 * What a choice row's control offers, for a choice the guide's own vocabulary
 * cannot stand in for: options observed rather than fixed by the build, or a
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
 * `section`, `order`, `rows`, `visible`, and `control`, the guide and the
 * settings search read `ids` and `guide`, the host's and the client's
 * side-effect tables are keyed by `sideEffect`, the counter reads `analytics`,
 * and a spoken change reads `spokenValue`. There is no second record of any of
 * it, and no `switch` anywhere over which setting this is.
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
  readonly resetScope?: SettingsResetScope;
  readonly sideEffect: SettingSideEffectId;
  readonly rows: SettingRows;
  /** The guide ids this one field speaks under. */
  readonly ids: readonly Id[];
  /** The guide entries it builds, or none for a field the guide covers elsewhere. */
  readonly guide: (
    settings: AppSettingGuideSettings,
  ) => AppGuideSetting | readonly AppGuideSetting[] | undefined;
  /** Whether its row is drawn right now. Absent means always drawn. */
  readonly visible?: (view: SettingsVisibility) => boolean;
  /**
   * Whether one of its guide ids is drawn right now, for the one field whose
   * entries stand under conditions of their own. Never declared beside
   * `visible`: a row cannot answer to two records of the same fact.
   */
  readonly visibleById?: Readonly<Partial<Record<Id, (view: SettingsVisibility) => boolean>>>;
  readonly control?: SettingControl<Value>;
  /** The value a spoken change's word means, for an adjustable setting. */
  readonly spokenValue?: (value: string) => Value | undefined;
  /**
   * How a change to it is counted. The id is derived: a change rides one
   * stored write, and `ids[0]` is the id that write is counted under.
   */
  readonly analytics?: { readonly value: (value: StoredSettingValue) => ProductSettingValue };
}
