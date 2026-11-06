import { ACT_KIND } from "@repo/host/acts";
import type {
  AppSettingField,
  AppSettingValue,
  SettingsResetScope,
  SettingsUpdateResult,
} from "@repo/settings/wire";
import type { ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { askActResult } from "../act.js";
import { actMutation, settingMutation } from "../act-mutations.js";

export interface SettingsWrites {
  setting(field: AppSettingField, value: AppSettingValue<AppSettingField>): Promise<ActionResult>;
  reset(scope: SettingsResetScope, kept: readonly AppSettingField[]): Promise<SettingsUpdateResult>;
}

export function useSettingsWrites(): SettingsWrites {
  const { mutateAsync: updateSetting } = useMutation(settingMutation());
  const { mutateAsync: resetSettings } = useMutation(actMutation(ACT_KIND.SETTINGS_RESET));
  return useMemo<SettingsWrites>(
    () => ({
      setting: (field, value) => askActResult(updateSetting({ field, value })),
      reset: (scope, kept) => resetSettings({ scope, kept: [...kept] }),
    }),
    [updateSetting, resetSettings],
  );
}
