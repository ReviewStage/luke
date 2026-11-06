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
  /** Returns a group to its defaults but for the fields `kept`, which the page does not draw, answering the settings as the reset left them, for an Undo to read what it changed. */
  reset(scope: SettingsResetScope, kept: readonly AppSettingField[]): Promise<SettingsUpdateResult>;
}

/**
 * The one way a settings row writes: through its own act, answering the row
 * with the store's own reply so a refusal lands where it was asked for. What
 * the rows then draw is the document, which carries the change to every
 * window including this one, so nothing here applies a snapshot.
 */
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
