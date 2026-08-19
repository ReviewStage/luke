import type { SessionProviderAdapter } from "@sidecar/core";
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
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  isAppSettingField,
  isKeyedAppSettingField,
  isSettingEntryKey,
  SETTING_SIDE_EFFECT,
  settingEntryGuard,
} from "../shared/settings-schema";

export interface SettingsRowsIpcDependencies {
  registerSettingHandler: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  adapterForCredential: (providerId: CredentialProviderId) => SessionProviderAdapter | undefined;
  refreshAdapter: (adapter: SessionProviderAdapter) => Promise<unknown>;
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
  } = dependencies;
  // The renderer can replace or clear a provider's credential but never reads
  // it back; the reply reports only where each key now comes from.
  registerSettingHandler(channels.setProviderApiKey, {
    validate(providerId: unknown, apiKey: unknown) {
      // The provider list is fixed by this build, so an id outside it is a
      // malformed request rather than something the user can correct.
      if (!isCredentialProviderId(providerId)) throw new Error("Unknown credential provider");
      if (apiKey !== undefined && typeof apiKey !== "string") {
        throw new Error("Invalid API key request");
      }
      return { providerId, apiKey };
    },
    save: ({ providerId, apiKey }) => settingsStore.setApiKey(providerId, apiKey),
    async apply(result, { providerId }) {
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
    },
    refusal: "Could not save that API key on this system.",
  });

  async function applySettingSideEffect(
    field: AppSettingField,
    value: AppSettingValue<AppSettingField>,
    settings: AppSettings,
    event: IpcMainInvokeEvent,
    waitForDeferredEffects = false,
  ): Promise<void> {
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
        hotkeys.setChosen(HOTKEY_RANK.TALK, value as string | undefined);
        await hotkeys.reapply(HOTKEY_RANK.TALK);
        break;
      case SETTING_SIDE_EFFECT.ASK_HOTKEY:
        hotkeys.setChosen(HOTKEY_RANK.ASK, value as string | undefined);
        if (waitForDeferredEffects) await hotkeys.reapply(HOTKEY_RANK.ASK);
        else void hotkeys.reapply(HOTKEY_RANK.ASK);
        break;
      case SETTING_SIDE_EFFECT.STOP_HOTKEY:
        hotkeys.setChosen(HOTKEY_RANK.STOP, value as string | undefined);
        if (waitForDeferredEffects) await hotkeys.reapply(HOTKEY_RANK.STOP);
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
      case SETTING_SIDE_EFFECT.NONE:
        break;
    }
  }

  registerSettingHandler(channels.updateSetting, {
    async validate(field: unknown, value: unknown) {
      if (!isAppSettingField(field)) throw new Error("Unknown setting");
      // A map-valued setting is written one entry at a time. Its own guard drops
      // entries it cannot hold rather than refusing them — right for reading a
      // stored file, wrong for a write, where a whole map of unholdable entries
      // would read as valid and silently clear what is stored.
      if (isKeyedAppSettingField(field)) throw new Error("Setting takes one entry at a time");
      const parsed = APP_SETTING_SCHEMA[field].guard(value);
      if (!parsed.valid) throw new Error("Invalid setting value");
      if (field === APP_SETTING_SCHEMA.askHotkey.field && typeof parsed.value === "string") {
        if (hotkeys.reserve(parsed.value, HOTKEY_RANK.ASK) === HOTKEY_RANK.TALK) {
          return new SettingsRefusal({
            settings: await settingsStore.snapshot(),
            reason: "That chord is reserved for the talk key.",
          });
        }
      }
      if (field === APP_SETTING_SCHEMA.stopHotkey.field && typeof parsed.value === "string") {
        const owner = hotkeys.reserve(parsed.value, HOTKEY_RANK.STOP);
        if (owner === HOTKEY_RANK.TALK || owner === HOTKEY_RANK.ASK) {
          return new SettingsRefusal({
            settings: await settingsStore.snapshot(),
            reason: `That chord is reserved for the ${owner === HOTKEY_RANK.TALK ? "talk" : "ask"} key.`,
          });
        }
      }
      return { field, value: parsed.value };
    },
    save: ({ field, value }) => settingsStore.set(field, value),
    async apply(result, { field, value }, event) {
      if (result.reason) return;
      await applySettingSideEffect(field, value, result.settings, event);
    },
    refusal: "Could not save that setting on this system.",
  });

  // One key of a map-valued preference. The merge belongs to the store, so what
  // arrives here is the single entry and the renderer never sends back a map it
  // read before an overlapping write landed.
  registerSettingHandler(channels.updateSettingEntry, {
    async validate(field: unknown, key: unknown, value: unknown) {
      if (!isKeyedAppSettingField(field)) throw new Error("Unknown setting");
      if (!isSettingEntryKey(field, key)) throw new Error("Unknown setting entry");
      const parsed = settingEntryGuard(field, key, value);
      if (!parsed.valid) throw new Error("Invalid setting value");
      if (
        field === APP_SETTING_SCHEMA.workspaceProjectDefaults.field &&
        typeof parsed.value === "string" &&
        !workspaceProjectOffered(key, parsed.value)
      ) {
        throw new Error("Unknown workspace project");
      }
      return { field, key, value: parsed.value };
    },
    save: ({ field, key, value }) => settingsStore.setEntry(field, key, value),
    async apply(result, { field }, event) {
      if (result.reason) return;
      await applySettingSideEffect(field, result.settings[field], result.settings, event);
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
    validate(scope: unknown) {
      if (!isSettingsResetScope(scope)) throw new Error("Invalid settings reset request");
      return scope;
    },
    save: (scope) => settingsStore.resetSettings(scope),
    async apply(result, scope, event) {
      if (result.reason) return;
      for (const field of APP_SETTING_FIELDS) {
        const definition = APP_SETTING_SCHEMA[field];
        if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
        await applySettingSideEffect(field, result.settings[field], result.settings, event, true);
      }
    },
    refusal: "Could not reset those settings on this system.",
  });
}
