import type {
  AppSettingField,
  AppSettingValue,
  SettingsResetScope,
  SettingsUpdateResult,
} from "@luke/settings/wire";
import type { ActionResult } from "@luke/wire";
import { useMemo } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";

export interface SettingsWrites {
  setting(field: AppSettingField, value: AppSettingValue<AppSettingField>): Promise<ActionResult>;
  /** Answers the settings as the reset left them, for an Undo to read what it changed. */
  reset(scope: SettingsResetScope): Promise<SettingsUpdateResult>;
}

/**
 * The one way a settings row writes: through its own act, answering the row
 * with the store's own reply so a refusal lands where it was asked for. What
 * the rows then draw is the document, which carries the change to every
 * window including this one, so nothing here applies a snapshot.
 */
export function useSettingsWrites(): SettingsWrites {
  const { act, updateSetting } = useAct();
  return useMemo<SettingsWrites>(
    () => ({
      setting: (field, value) => updateSetting(field, value),
      reset: (scope) => act(ACT_KIND.SETTINGS_RESET, { scope }),
    }),
    [act, updateSetting],
  );
}
