/**
 * How a setting describes itself and the panel's tabs, said once so the
 * settings rows, the settings search, and the analytics name the same words.
 * Nothing here may ever carry a credential: a setting says *whether* a
 * provider is connected, never what connects it.
 */

/** How a setting takes a value: a switch, or one choice from a fixed set. */
export const APP_SETTING_KIND = {
  TOGGLE: "toggle",
  CHOICE: "choice",
} as const;

type AppSettingKind = (typeof APP_SETTING_KIND)[keyof typeof APP_SETTING_KIND];

/** The two words a toggle's state is written in. */
export const APP_TOGGLE_VALUE = {
  ON: "on",
  OFF: "off",
} as const;

type AppToggleValue = (typeof APP_TOGGLE_VALUE)[keyof typeof APP_TOGGLE_VALUE];

/**
 * One user-owned setting as its row and the settings search read it: what it
 * is called, what it cannot say for itself, and what it is set to now.
 */
export interface DescribedSetting {
  /** The setting's id, which its row wears as the search's landing anchor. */
  id: string;
  label: string;
  /**
   * What the row cannot say for itself: a consequence or an instruction, drawn
   * under the label. Absent where the label and control already say it all.
   */
  detail?: string;
  kind: AppSettingKind;
  /** The current value: `on`/`off`, or the choice's own token. */
  value: string;
}

/** The window's two places, and so the tabs a panel-tab change is counted as. */
export const APP_PANEL_TAB = {
  /** The named tasks, and the one open task's saved document and call. */
  TASKS: "plans",
  SETTINGS: "settings",
} as const;

export type AppPanelTab = (typeof APP_PANEL_TAB)[keyof typeof APP_PANEL_TAB];

/** A toggle's state, in the words its row reads. */
export function appToggleText(enabled: boolean): AppToggleValue {
  return enabled ? APP_TOGGLE_VALUE.ON : APP_TOGGLE_VALUE.OFF;
}
