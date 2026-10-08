/**
 * The app guide's vocabulary: how a setting describes itself and the panel's
 * tabs, said once so the settings search, the
 * renderer, and the analytics name the same words. Nothing here may ever
 * carry a credential: a setting says *whether* a provider is connected, never
 * what connects it.
 */

/** How a setting takes a value: a switch, or one choice from a fixed set. */
export const APP_SETTING_KIND = {
  TOGGLE: "toggle",
  CHOICE: "choice",
} as const;

type AppSettingKind = (typeof APP_SETTING_KIND)[keyof typeof APP_SETTING_KIND];

/** The two words a toggle's state is said in, on screen and out loud. */
export const APP_TOGGLE_VALUE = {
  ON: "on",
  OFF: "off",
} as const;

type AppToggleValue = (typeof APP_TOGGLE_VALUE)[keyof typeof APP_TOGGLE_VALUE];

/**
 * One user-owned setting, as the guide describes it: what it is called, what
 * it does, what it is set to now, and how it changes. `adjustable` is what
 * separates a setting a spoken ask may change from one that can only be
 * described — a credential, a system permission — and `manual` is the answer
 * either way, because a conversation that changes a setting should still be
 * able to say where the switch lives.
 */
export interface AppGuideSetting {
  /** The id a spoken change names it by, exactly as the guide lists it. */
  id: string;
  label: string;
  /** What the setting does, in one sentence. */
  description: string;
  kind: AppSettingKind;
  /** The current value as it should be said: `on`/`off`, or one of `choices`. */
  value: string;
  /**
   * The value the setting holds until the user chooses, said the same way as
   * `value` — it is what an ask for "the default" is a change to, so a guide
   * without it is one that cannot honour that ask. Absent only for something
   * the app has no default of its own for, such as a system permission.
   */
  defaultValue?: string;
  /** Every value a choice accepts, in the order settings offers them. */
  choices?: readonly string[];
  /** Whether a spoken ask may change it; false means describe, never act. */
  adjustable: boolean;
  /** Where the same change is made by hand. */
  manual: string;
}

/** The window's two places, and so the tabs a panel-tab change is counted as. */
export const APP_PANEL_TAB = {
  /** The named plans, and the one open plan's saved document and call. */
  PLANS: "plans",
  SETTINGS: "settings",
} as const;

export type AppPanelTab = (typeof APP_PANEL_TAB)[keyof typeof APP_PANEL_TAB];

/** The guide's own rendering of a toggle's state. */
export function appToggleText(enabled: boolean): AppToggleValue {
  return enabled ? APP_TOGGLE_VALUE.ON : APP_TOGGLE_VALUE.OFF;
}
