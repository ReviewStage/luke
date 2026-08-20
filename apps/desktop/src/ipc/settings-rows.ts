import {
  isWireString,
  PRODUCT_EVENT,
  type RecordProductEvent,
  type SessionProviderAdapter,
  type UnparsedWireValue,
} from "@sidecar/core";
import { Effect } from "effect";
import type { IpcMainInvokeEvent } from "electron";
import type { DockPresence } from "../dock-presence";
import { HOTKEY_RANK, type HotkeyRegistrar } from "../hotkey-registrar";
import type { MediaDuckController } from "../media-duck";
import type { PanelManager } from "../panel-manager";
import type { RealtimeCredentialMinter } from "../realtime-minter";
import { type createSettingsHandler, SettingsRefusal } from "../settings-handler";
import type { SettingsStore } from "../settings-store";
import { type AppSettings, channels, isSettingsResetScope } from "../shared/contracts";
import {
  CREDENTIAL_PROVIDER_ID,
  type CredentialProviderId,
  isCredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "../shared/credential-providers";
import { CONNECTION_COUNTED_AS } from "../shared/product-vocabulary";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  isAppSettingField,
  isKeyedAppSettingField,
  isSettingEntryKey,
  SETTING_SIDE_EFFECT,
  settingAnalytics,
  settingEntryGuard,
} from "../shared/settings-schema";

export interface SettingsRowsIpcDependencies {
  registerSettingHandler: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  adapterForCredential: (providerId: CredentialProviderId) => SessionProviderAdapter | undefined;
  refreshAdapter: (adapter: SessionProviderAdapter) => Promise<void>;
  refreshIssues: () => void;
  applyVoiceCredential: () => Promise<void>;
  hotkeys: HotkeyRegistrar;
  dock: DockPresence;
  panels: PanelManager;
  realtimeCredentials: () => RealtimeCredentialMinter | undefined;
  mediaDuck: MediaDuckController;
  workspaceProjectOffered: (providerId: string, providerProjectId: string) => boolean;
  refreshMeetingQuiet: () => void;
  releaseHeldNotices: () => void;
  /** Moves the counting switch, which is also what records the move itself. */
  setUsageSharing: (enabled: boolean) => void;
  recordProductEvent: RecordProductEvent;
}

export function registerSettingsRowsIpc(dependencies: SettingsRowsIpcDependencies): void {
  const {
    registerSettingHandler,
    settingsStore,
    adapterForCredential,
    refreshAdapter,
    refreshIssues,
    applyVoiceCredential,
    hotkeys,
    dock,
    panels,
    realtimeCredentials,
    mediaDuck,
    workspaceProjectOffered,
    refreshMeetingQuiet,
    releaseHeldNotices,
    setUsageSharing,
    recordProductEvent,
  } = dependencies;
  // The renderer can replace or clear a provider's credential but never reads
  // it back; the reply reports only where each key now comes from.
  registerSettingHandler(channels.setProviderApiKey, {
    validate(providerId: UnparsedWireValue, apiKey: UnparsedWireValue) {
      // The provider list is fixed by this build, so an id outside it is a
      // malformed request rather than something the user can correct.
      if (!isCredentialProviderId(providerId)) throw new Error("Unknown credential provider");
      if (apiKey !== undefined && !isWireString(apiKey)) {
        throw new Error("Invalid API key request");
      }
      return { providerId, apiKey };
    },
    save: ({ providerId, apiKey }) => settingsStore.setApiKey(providerId, apiKey),
    apply(result, { providerId, apiKey }) {
      const adapter = adapterForCredential(providerId);
      if (!result.reason && adapter) void refreshAdapter(adapter);
      if (!result.reason && providerId === CREDENTIAL_PROVIDER_ID.LINEAR) {
        refreshIssues();
      }
      if (!result.reason && providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
        void applyVoiceCredential().then(() => hotkeys.reapply(HOTKEY_RANK.TALK));
      }
      // The store reads a blank key as a clearing, so the count reads it the
      // same way rather than reporting a connection that did not happen.
      if (!result.reason) {
        recordProductEvent(
          apiKey?.trim() ? PRODUCT_EVENT.PROVIDER_CONNECT : PRODUCT_EVENT.PROVIDER_DISCONNECT,
          { connection_id: CONNECTION_COUNTED_AS[providerId] },
        );
      }
    },
    refusal: "Could not save that API key on this system.",
  });

  /**
   * Counts a setting that just moved, for a setting the schema says to count.
   * The id travels and the shape of the new value does; the value itself never
   * does, because several of these hold a project name or a chord the
   * developer typed.
   */
  function recordSettingUpdate(field: AppSettingField, settings: AppSettings): void {
    const analytics = settingAnalytics(field, settings);
    if (!analytics) return;
    recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
      setting_id: analytics.id,
      setting_value: analytics.value,
    });
  }

  function applySettingSideEffect(
    field: AppSettingField,
    value: AppSettingValue<AppSettingField>,
    settings: AppSettings,
    event: IpcMainInvokeEvent,
    waitForDeferredEffects = false,
  ): void {
    switch (APP_SETTING_SCHEMA[field].mainProcessSideEffect) {
      case SETTING_SIDE_EFFECT.DOCK:
        dock.apply(settings.showInDock, panels.displayIdFor(event.sender));
        break;
      case SETTING_SIDE_EFFECT.DISPLAYS:
        panels.setShowOnAllDisplays(settings.showOnAllDisplays);
        panels.reconcile();
        break;
      case SETTING_SIDE_EFFECT.FORM_FACTOR:
        panels.setFormFactor(settings.formFactor);
        panels.positionAll();
        break;
      case SETTING_SIDE_EFFECT.VOICE:
        realtimeCredentials()?.setVoice(settings.voice);
        break;
      case SETTING_SIDE_EFFECT.VOICE_SPEED:
        realtimeCredentials()?.setSpeed(settings.voiceSpeed);
        break;
      case SETTING_SIDE_EFFECT.TALK_HOTKEY:
        // SAFETY: The preceding check establishes the asserted contract.
        hotkeys.setChosen(HOTKEY_RANK.TALK, value as string | undefined);
        if (waitForDeferredEffects) void hotkeys.reapply(HOTKEY_RANK.TALK);
        else void hotkeys.reapply(HOTKEY_RANK.TALK);
        break;
      case SETTING_SIDE_EFFECT.ASK_HOTKEY:
        // SAFETY: The preceding check establishes the asserted contract.
        hotkeys.setChosen(HOTKEY_RANK.ASK, value as string | undefined);
        if (waitForDeferredEffects) void hotkeys.reapply(HOTKEY_RANK.ASK);
        else void hotkeys.reapply(HOTKEY_RANK.ASK);
        break;
      case SETTING_SIDE_EFFECT.STOP_HOTKEY:
        // SAFETY: The preceding check establishes the asserted contract.
        hotkeys.setChosen(HOTKEY_RANK.STOP, value as string | undefined);
        if (waitForDeferredEffects) void hotkeys.reapply(HOTKEY_RANK.STOP);
        else void hotkeys.reapply(HOTKEY_RANK.STOP);
        break;
      case SETTING_SIDE_EFFECT.MEDIA_DUCK:
        mediaDuck.setEnabled(settings.duckOtherMedia);
        break;
      case SETTING_SIDE_EFFECT.VOICE_SOURCE:
        void applyVoiceCredential();
        break;
      case SETTING_SIDE_EFFECT.MEETING_QUIET:
        refreshMeetingQuiet();
        releaseHeldNotices();
        break;
      case SETTING_SIDE_EFFECT.USAGE_SHARING:
        setUsageSharing(settings.shareUsageData);
        break;
      case SETTING_SIDE_EFFECT.NONE:
        break;
    }
  }

  registerSettingHandler(channels.updateSetting, {
    validate(field: UnparsedWireValue, value: UnparsedWireValue) {
      if (!isAppSettingField(field)) throw new Error("Unknown setting");
      if (isKeyedAppSettingField(field)) throw new Error("Setting takes one entry at a time");
      const parsed = APP_SETTING_SCHEMA[field].guard(value);
      if (!parsed.valid) throw new Error("Invalid setting value");
      if (field === APP_SETTING_SCHEMA.askHotkey.field && isWireString(parsed.value)) {
        if (hotkeys.reserve(parsed.value, HOTKEY_RANK.ASK) === HOTKEY_RANK.TALK) {
          return Effect.map(
            settingsStore.snapshot(),
            (settings) =>
              new SettingsRefusal({
                settings,
                reason: "That chord is reserved for the talk key.",
              }),
          );
        }
      }
      if (field === APP_SETTING_SCHEMA.stopHotkey.field && isWireString(parsed.value)) {
        const owner = hotkeys.reserve(parsed.value, HOTKEY_RANK.STOP);
        if (owner === HOTKEY_RANK.TALK || owner === HOTKEY_RANK.ASK) {
          return Effect.map(
            settingsStore.snapshot(),
            (settings) =>
              new SettingsRefusal({
                settings,
                reason: `That chord is reserved for the ${owner === HOTKEY_RANK.TALK ? "talk" : "ask"} key.`,
              }),
          );
        }
      }
      return { field, value: parsed.value };
    },
    save: ({ field, value }) => settingsStore.set(field, value),
    apply(result, { field, value }, event) {
      if (result.reason) return;
      recordSettingUpdate(field, result.settings);
      void applySettingSideEffect(field, value, result.settings, event);
    },
    refusal: "Could not save that setting on this system.",
  });

  // One key of a map-valued preference. The merge belongs to the store, so what
  // arrives here is the single entry and the renderer never sends back a map it
  // read before an overlapping write landed.
  registerSettingHandler(channels.updateSettingEntry, {
    validate(field: UnparsedWireValue, key: UnparsedWireValue, value: UnparsedWireValue) {
      if (!isKeyedAppSettingField(field)) throw new Error("Unknown setting");
      if (!isSettingEntryKey(field, key)) throw new Error("Unknown setting entry");
      const parsed = settingEntryGuard(field, key, value);
      if (!parsed.valid) throw new Error("Invalid setting value");
      const projectValue = parsed.value;
      // SAFETY: settingEntryGuard validated workspace project defaults as a wire string.
      const projectWire = projectValue as UnparsedWireValue;
      if (
        field === APP_SETTING_SCHEMA.workspaceProjectDefaults.field &&
        isWireString(projectWire)
      ) {
        if (!workspaceProjectOffered(key, projectWire)) {
          throw new Error("Unknown workspace project");
        }
      }
      return { field, key, value: parsed.value };
    },
    save: ({ field, key, value }) =>
      settingsStore.setEntry(
        field,
        key,
        // SAFETY: settingEntryGuard validated the entry before it reaches the store.
        value as UnparsedWireValue,
      ),
    apply(result, { field }, event) {
      if (result.reason) return;
      recordSettingUpdate(field, result.settings);
      void applySettingSideEffect(field, result.settings[field], result.settings, event);
    },
    refusal: "Could not save that setting on this system.",
  });

  // One group of preferences returned to its defaults in a single stored
  // write. The renderer names a scope from the set fixed by this build —
  // never a field list — and the store forgets the choices behind it, so
  // what stands afterwards is the default itself rather than a copy of it.
  // No scope reaches a credential or an account. The side effects each row's
  // own save runs are re-run here from the stored answer, so a reset takes
  // effect at once the way every other settings change does.
  registerSettingHandler(channels.resetSettings, {
    validate(scope: UnparsedWireValue) {
      if (!isSettingsResetScope(scope)) throw new Error("Invalid settings reset request");
      return scope;
    },
    save: (scope) => settingsStore.resetSettings(scope),
    apply(result, scope, event) {
      if (result.reason) return;
      for (const field of APP_SETTING_FIELDS) {
        const definition = APP_SETTING_SCHEMA[field];
        if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
        applySettingSideEffect(field, result.settings[field], result.settings, event, true);
      }
    },
    refusal: "Could not reset those settings on this system.",
  });
}
