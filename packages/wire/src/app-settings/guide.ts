export const APP_SETTING_KIND = {
  TOGGLE: "toggle",
  CHOICE: "choice",
} as const;

type AppSettingKind = (typeof APP_SETTING_KIND)[keyof typeof APP_SETTING_KIND];

export const APP_TOGGLE_VALUE = {
  ON: "on",
  OFF: "off",
} as const;

type AppToggleValue = (typeof APP_TOGGLE_VALUE)[keyof typeof APP_TOGGLE_VALUE];

export interface DescribedSetting {
  id: string;
  label: string;
  detail?: string;
  kind: AppSettingKind;
  value: string;
}

export const APP_PANEL_TAB = {
  TASKS: "plans",
  SETTINGS: "settings",
} as const;

export type AppPanelTab = (typeof APP_PANEL_TAB)[keyof typeof APP_PANEL_TAB];

export function appToggleText(enabled: boolean): AppToggleValue {
  return enabled ? APP_TOGGLE_VALUE.ON : APP_TOGGLE_VALUE.OFF;
}
