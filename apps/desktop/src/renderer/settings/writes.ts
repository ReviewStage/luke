import type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
  SettingsResetScope,
} from "@sidecar/settings/wire";
import type { ActionResult } from "@sidecar/wire";
import { ACT_KIND } from "#shared/messages/acts";
import { act, updateSetting, updateSettingEntry } from "../act";

export interface SettingsWrites {
  setting(field: AppSettingField, value: AppSettingValue<AppSettingField>): Promise<ActionResult>;
  entry(
    field: KeyedAppSettingField,
    key: string,
    value: SettingEntryValue<KeyedAppSettingField> | undefined,
  ): Promise<ActionResult>;
  reset(scope: SettingsResetScope): Promise<ActionResult>;
}

/**
 * The one way a settings row writes: through its own act, answering the row
 * with the store's own reply so a refusal lands where it was asked for. What
 * the rows then draw is the document, which carries the change to every
 * window including this one, so nothing here applies a snapshot — and with
 * nothing to close over, one shared value serves the settings panel and the
 * rows the calendar gate borrows from it alike.
 */
export const SETTINGS_WRITES: SettingsWrites = {
  setting: (field, value) => updateSetting(field, value),
  entry: (field, key, value) => updateSettingEntry(field, key, value),
  reset: (scope) => act(ACT_KIND.SETTINGS_RESET, { scope }),
};
