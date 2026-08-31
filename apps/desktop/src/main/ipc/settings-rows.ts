import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import {
  CREDENTIAL_PROVIDER_ID,
  type CredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "@sidecar/credentials";
import type { SessionProviderAdapter } from "@sidecar/session";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  SETTING_SIDE_EFFECT,
  settingAnalytics,
  settingEntryGuard,
} from "@sidecar/settings";
import type { RealtimeCredentialMinter } from "@sidecar/voice";
import { ACT_RESULT_STATUS, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { BRIDGE, type BridgeArgumentsFor } from "#shared/bridge";
import type { AppSettings } from "#shared/contracts";
import { CONNECTION_COUNTED_AS } from "#shared/product-vocabulary";
import type { MediaDuckController } from "../native/media-duck";
import type { BridgeContext } from "../register-bridge";
import { type createSettingsHandler, SettingsRefusal } from "../settings-handler";
import type { SettingsStore } from "../settings-store";
import type { DockPresence } from "../window/dock-presence";
import { HOTKEY_RANK, type HotkeyRegistrar } from "../window/hotkey-registrar";
import type { PanelManager } from "../window/panel-manager";

export interface SettingsRowsIpcDependencies {
  registerSettingHandler: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  adapterForCredential: (providerId: CredentialProviderId) => SessionProviderAdapter | undefined;
  refreshAdapter: (adapter: SessionProviderAdapter) => Promise<void>;
  refreshIssues: () => void;
  applyVoiceCredential: () => Promise<void>;
  hotkeys: HotkeyRegistrar;
  dock: DockPresence;
  applyLoginItem: (openAtLogin: boolean) => void;
  panels: PanelManager;
  realtimeCredentials: () => RealtimeCredentialMinter | undefined;
  mediaDuck: MediaDuckController;
  workspaceProjectOffered: (providerId: string, providerProjectId: string) => boolean;
  refreshMeetingQuiet: () => void;
  releaseHeldNotices: () => void;
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
    applyLoginItem,
    panels,
    realtimeCredentials,
    mediaDuck,
    workspaceProjectOffered,
    refreshMeetingQuiet,
    releaseHeldNotices,
    recordProductEvent,
  } = dependencies;
  // The renderer can replace or clear a provider's credential but never reads
  // it back; the reply reports only where each key now comes from.
  registerSettingHandler(BRIDGE.setProviderApiKey, {
    validate(providerId, apiKey) {
      return { providerId, apiKey };
    },
    save: ({ providerId, apiKey }) => settingsStore.setApiKey(providerId, apiKey),
    async apply(result, { providerId, apiKey }) {
      // Only the provider whose key changed is affected, so the local
      // observers are left alone rather than re-crawling the filesystem on
      // every save.
      const adapter = adapterForCredential(providerId);
      if (!result.reason && adapter) void refreshAdapter(adapter);
      // The tracker's key connects the tracker, not a session provider, so
      // its save refreshes the roster instead of the registry.
      if (!result.reason && providerId === CREDENTIAL_PROVIDER_ID.LINEAR) {
        refreshIssues();
      }
      // The voice key connects neither: it is what the spoken conversation and
      // the attention review are built from, so a change to it rebuilds both
      // and then moves the talk key — claimed now that there is something to
      // talk to, or given back to the machine now that there is not. Awaited,
      // because a press right after the save has to find a minter.
      if (!result.reason && providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
        await applyVoiceCredential();
        await hotkeys.reapply(HOTKEY_RANK.TALK);
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
    const analytics = settingAnalytics(field, settings.stored);
    if (!analytics) return;
    recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
      setting_id: analytics.id,
      setting_value: analytics.value,
    });
  }

  async function applySettingSideEffect(
    field: AppSettingField,
    settings: AppSettings,
    context: BridgeContext,
    waitForDeferredEffects = false,
  ): Promise<void> {
    switch (APP_SETTING_SCHEMA[field].mainProcessSideEffect) {
      case SETTING_SIDE_EFFECT.LOGIN_ITEM:
        applyLoginItem(settings.stored.openAtLogin);
        break;
      case SETTING_SIDE_EFFECT.DOCK:
        dock.apply(settings.stored.showInDock, panels.displayIdFor(context.sender));
        break;
      case SETTING_SIDE_EFFECT.DISPLAYS:
        panels.setShowOnAllDisplays(settings.stored.showOnAllDisplays);
        panels.reconcile();
        break;
      case SETTING_SIDE_EFFECT.FORM_FACTOR:
        panels.setFormFactor(settings.stored.formFactor ?? APP_SETTING_SCHEMA.formFactor.default);
        panels.positionAll();
        break;
      case SETTING_SIDE_EFFECT.VOICE:
        realtimeCredentials()?.setVoice(settings.stored.voice);
        break;
      case SETTING_SIDE_EFFECT.VOICE_SPEED:
        realtimeCredentials()?.setSpeed(settings.stored.voiceSpeed);
        break;
      case SETTING_SIDE_EFFECT.TALK_HOTKEY:
        hotkeys.setChosen(HOTKEY_RANK.TALK, settings.stored.voiceHotkey);
        await hotkeys.reapply(HOTKEY_RANK.TALK);
        break;
      case SETTING_SIDE_EFFECT.ASK_HOTKEY:
        hotkeys.setChosen(HOTKEY_RANK.ASK, settings.stored.askHotkey);
        if (waitForDeferredEffects) await hotkeys.reapply(HOTKEY_RANK.ASK);
        else void hotkeys.reapply(HOTKEY_RANK.ASK);
        break;
      case SETTING_SIDE_EFFECT.STOP_HOTKEY:
        hotkeys.setChosen(HOTKEY_RANK.STOP, settings.stored.stopHotkey);
        if (waitForDeferredEffects) await hotkeys.reapply(HOTKEY_RANK.STOP);
        else void hotkeys.reapply(HOTKEY_RANK.STOP);
        break;
      case SETTING_SIDE_EFFECT.MEDIA_DUCK:
        mediaDuck.setEnabled(settings.stored.duckOtherMedia);
        break;
      case SETTING_SIDE_EFFECT.VOICE_SOURCE:
        void applyVoiceCredential();
        break;
      case SETTING_SIDE_EFFECT.MEETING_QUIET:
        refreshMeetingQuiet();
        releaseHeldNotices();
        break;
      case SETTING_SIDE_EFFECT.NONE:
        break;
    }
  }

  registerSettingHandler(BRIDGE.updateSetting, {
    async validate(...[field, value]: BridgeArgumentsFor<"updateSetting">) {
      const parsed = APP_SETTING_SCHEMA[field].guard(value);
      if (!parsed.valid) throw new Error("Bridge setting guard drift");
      if (field === APP_SETTING_SCHEMA.askHotkey.field && isWireString(parsed.value)) {
        if (hotkeys.reserve(parsed.value, HOTKEY_RANK.ASK) === HOTKEY_RANK.TALK) {
          return new SettingsRefusal({
            status: ACT_RESULT_STATUS.REJECTED,
            settings: await settingsStore.snapshot(),
            reason: "That chord is reserved for the talk key.",
          });
        }
      }
      if (field === APP_SETTING_SCHEMA.stopHotkey.field && isWireString(parsed.value)) {
        const owner = hotkeys.reserve(parsed.value, HOTKEY_RANK.STOP);
        if (owner === HOTKEY_RANK.TALK || owner === HOTKEY_RANK.ASK) {
          return new SettingsRefusal({
            status: ACT_RESULT_STATUS.REJECTED,
            settings: await settingsStore.snapshot(),
            reason: `That chord is reserved for the ${owner === HOTKEY_RANK.TALK ? "talk" : "ask"} key.`,
          });
        }
      }
      return { field, value: parsed.value };
    },
    save: ({ field, value }) => settingsStore.set(field, value),
    async apply(result, { field }, event) {
      if (result.reason) return;
      recordSettingUpdate(field, result.settings);
      await applySettingSideEffect(field, result.settings, event);
    },
    refusal: "Could not save that setting on this system.",
  });

  // One key of a map-valued preference. The merge belongs to the store, so what
  // arrives here is the single entry and the renderer never sends back a map it
  // read before an overlapping write landed.
  registerSettingHandler(BRIDGE.updateSettingEntry, {
    async validate(...[field, key, value]: BridgeArgumentsFor<"updateSettingEntry">) {
      // SAFETY: BRIDGE.updateSettingEntry parsed the field-specific structured-clone value.
      const parsed = settingEntryGuard(field, key, value as UnparsedWireValue);
      if (!parsed.valid) throw new Error("Bridge setting-entry guard drift");
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
    async apply(result, { field }, event) {
      if (result.reason) return;
      recordSettingUpdate(field, result.settings);
      await applySettingSideEffect(field, result.settings, event);
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
  registerSettingHandler(BRIDGE.resetSettings, {
    validate(scope) {
      return scope;
    },
    save: (scope) => settingsStore.resetSettings(scope),
    async apply(result, scope, event) {
      if (result.reason) return;
      // One event for the reset itself rather than a `setting:update` per
      // field it touched. A scope returns a whole group at once, so per-field
      // counts would read as a burst of deliberate changes nobody made — and
      // the scope's own name is not counted for the same reason the fields
      // are not: the fact that people reset is the question here.
      recordProductEvent(PRODUCT_EVENT.SETTINGS_RESET, {});
      for (const field of APP_SETTING_FIELDS) {
        const definition = APP_SETTING_SCHEMA[field];
        if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
        await applySettingSideEffect(field, result.settings, event, true);
      }
    },
    refusal: "Could not reset those settings on this system.",
  });
}
