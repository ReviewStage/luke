import assert from "node:assert/strict";
import type { WorkspaceAgentSelection } from "@sidecar/session";
import {
  APP_SETTING_FIELDS,
  type AppSettingField,
  type AppSettingValue,
  type StoredAppSettings,
} from "@sidecar/settings";
import type { AppBridge, SettingsUpdateResult } from "#shared/contracts";
import type { AppSettings, AppSettingsView, RuntimeStatus } from "#shared/wire/settings";

export type SpokenSettingBridge = Pick<AppBridge, "updateSetting" | "updateSettingEntry">;

/**
 * A fixture bridge as a test writes one: each carrier optional, and each stated
 * at its widest field rather than generically. The bridge's own methods are
 * generic in the field they name, and a concrete function is not assignable to
 * a generic signature — so the two are reconciled in one place instead of at
 * every fixture.
 */
export interface SpokenSettingBridgeFixture {
  updateSetting?: (
    field: AppSettingField,
    value: AppSettingValue<AppSettingField>,
  ) => Promise<SettingsUpdateResult>;
  // Named concretely because one setting is keyed today and its entries are
  // agent selections; a second keyed setting makes this a compile error here
  // rather than a fixture quietly accepting the wrong value.
  updateSettingEntry?: (
    field: string,
    key: string,
    value: WorkspaceAgentSelection | undefined,
  ) => Promise<SettingsUpdateResult>;
}

/** Names a fixture bridge with the same contract applySpokenSetting validates. */
export function spokenSettingBridge(fixture: SpokenSettingBridgeFixture): SpokenSettingBridge {
  // A carrier the fixture leaves out is one the test is asserting never runs.
  return {
    async updateSetting(field, value) {
      const carry = fixture.updateSetting;
      assert.ok(carry, "updateSetting ran on a fixture that does not carry it");
      return carry(field, value);
    },
    async updateSettingEntry(field, key, value) {
      const carry = fixture.updateSettingEntry;
      assert.ok(carry, "updateSettingEntry ran on a fixture that does not carry it");
      // SAFETY: one setting is keyed today and its entries are agent
      // selections; the value's own type stays deferred while its field is a
      // type parameter, so the fixture is handed what the bridge really passes.
      return carry(field, key, value as WorkspaceAgentSelection | undefined);
    },
  };
}

/** Turns a renderer view back into wire state for settings-update fixtures. */
export function appSettingsWire(settings: AppSettingsView): AppSettings {
  const storedEntries = Object.fromEntries(
    APP_SETTING_FIELDS.map((field) => [field, settings[field]]),
  );
  // SAFETY: APP_SETTING_FIELDS enumerates every schema-derived stored field exactly once.
  const stored = storedEntries as StoredAppSettings;
  const status: RuntimeStatus = {
    credentialSources: settings.credentialSources,
    secretStorage: settings.secretStorage,
    voiceAvailable: settings.voiceAvailable,
    calendarSignInAvailable: settings.calendarSignInAvailable,
    linearSignInAvailable: settings.linearSignInAvailable,
    calendarAccounts: settings.calendarAccounts,
    appleCalendarAvailable: settings.appleCalendarAvailable,
    ...(settings.appleCalendar ? { appleCalendar: settings.appleCalendar } : undefined),
  };
  return { stored, status };
}
