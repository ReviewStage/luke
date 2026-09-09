import type { RecordProductEvent } from "@sidecar/analytics";
import { VOICE_CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  SETTING_SIDE_EFFECT,
} from "@sidecar/settings";
import { ACT_RESULT_STATUS, isWireString } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { APPLE_CALENDAR_ACCESS, CALENDAR_PRIVACY_PANE_URL } from "#shared/apple-calendar";
import { BRIDGE, type BridgeArgumentsFor } from "#shared/bridge";
import type { AppSettings } from "#shared/messages/settings";
import type { HostOperator } from "../gateway/host-operator";
import type { MediaDuckController } from "../native/media-duck";
import { type BridgeContext, registerBridge } from "../register-bridge";
import { type createSettingsHandler, SettingsRefusal } from "../settings-handler";
import type { DockPresence } from "../window/dock-presence";
import { HOTKEY_RANK, type HotkeyRegistrar } from "../window/hotkey-registrar";
import type { PanelManager } from "../window/panel-manager";

/**
 * The settings rows as the desktop client answers them: each write is
 * validated here where the client alone can — the chord reservations the keys
 * hold — carried to the host, which stores it, applies its own side effects,
 * counts it, and tells every other window; and then applied here for the side
 * effects only this process has hands on: the login item, the Dock, the
 * displays, the form factor, the keys, the duck.
 */
export interface SettingsRowsIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSettingHandler: ReturnType<typeof createSettingsHandler>;
  host: HostOperator;
  /** The opaque token naming the window that asked, so the host's change event is not echoed back to it. */
  reporterOf: (context: BridgeContext) => string;
  /** The settings snapshot as this client last saw it, for the refusals worded here. */
  lastSettings: () => AppSettings | undefined;
  hotkeys: HotkeyRegistrar;
  dock: DockPresence;
  applyLoginItem: (openAtLogin: boolean) => void;
  panels: PanelManager;
  mediaDuck: MediaDuckController;
  recordProductEvent: RecordProductEvent;
  /** Opens a page in the default browser; the address lives in this file. */
  openExternal: (url: string) => void;
}

export function registerSettingsRowsIpc(dependencies: SettingsRowsIpcDependencies): void {
  const {
    registerSettingHandler,
    host,
    reporterOf,
    hotkeys,
    dock,
    applyLoginItem,
    panels,
    mediaDuck,
  } = dependencies;

  const refusal = async (reason: string): Promise<SettingsRefusal> => {
    const settings = dependencies.lastSettings() ?? (await host.settingsSnapshot());
    if (!settings) throw new Error(reason);
    return new SettingsRefusal({ status: ACT_RESULT_STATUS.REJECTED, settings, reason });
  };

  // The renderer can replace or clear a provider's credential but never reads
  // it back; the reply reports only where each key now comes from, and the key
  // itself crosses once, to the host that keeps it.
  registerSettingHandler(BRIDGE.setProviderApiKey, {
    validate(providerId, apiKey) {
      return { providerId, apiKey };
    },
    save: ({ providerId, apiKey }, context) =>
      host.setProviderApiKey(providerId, apiKey, reporterOf(context)),
    async apply(result, { providerId }) {
      // The voice key is what the talk key is claimed for: once the host has
      // rebuilt the voice on it, the key moves — claimed now that there is
      // something to talk to, or given back now that there is not.
      if (!result.reason && providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
        await hotkeys.reapply(HOTKEY_RANK.TALK);
      }
    },
    refusal: "Could not save that API key on this system.",
  });

  /** The side effects this process has hands on; the host applied its own before answering. */
  async function applyClientSettingSideEffect(
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
        // The host rebuilt the voice; the key follows what it now has.
        await hotkeys.reapply(HOTKEY_RANK.TALK);
        break;
      default:
        break;
    }
  }

  registerSettingHandler(BRIDGE.updateSetting, {
    async validate(...[field, value]: BridgeArgumentsFor<"updateSetting">) {
      const parsed = APP_SETTING_SCHEMA[field].guard(value);
      if (!parsed.valid) throw new Error("Bridge setting guard drift");
      if (field === APP_SETTING_SCHEMA.askHotkey.field && isWireString(parsed.value)) {
        if (hotkeys.reserve(parsed.value, HOTKEY_RANK.ASK) === HOTKEY_RANK.TALK) {
          return refusal("That chord is reserved for the talk key.");
        }
      }
      if (field === APP_SETTING_SCHEMA.stopHotkey.field && isWireString(parsed.value)) {
        const owner = hotkeys.reserve(parsed.value, HOTKEY_RANK.STOP);
        if (owner === HOTKEY_RANK.TALK || owner === HOTKEY_RANK.ASK) {
          return refusal(
            `That chord is reserved for the ${owner === HOTKEY_RANK.TALK ? "talk" : "ask"} key.`,
          );
        }
      }
      return { field, value: parsed.value };
    },
    save: ({ field, value }, context) =>
      // SAFETY: the schema guard above validated this value for its field.
      host.updateSetting(field, value as never, reporterOf(context)),
    async apply(result, { field }, context) {
      if (result.reason) return;
      await applyClientSettingSideEffect(field, result.settings, context);
    },
    refusal: "Could not save that setting on this system.",
  });

  registerSettingHandler(BRIDGE.updateSettingEntry, {
    validate(...[field, key, value]: BridgeArgumentsFor<"updateSettingEntry">) {
      return { field, key, value };
    },
    save: ({ field, key, value }, context) =>
      // SAFETY: the bridge's entry guard validated this value; the host guards it again.
      host.updateSettingEntry(field, key, value as never, reporterOf(context)),
    async apply(result, { field }, context) {
      if (result.reason) return;
      await applyClientSettingSideEffect(field, result.settings, context);
    },
    refusal: "Could not save that setting on this system.",
  });

  registerSettingHandler(BRIDGE.resetSettings, {
    validate(scope) {
      return scope;
    },
    save: (scope, context) => host.resetSettings(scope, reporterOf(context)),
    async apply(result, scope, context) {
      if (result.reason) return;
      for (const field of APP_SETTING_FIELDS) {
        const definition = APP_SETTING_SCHEMA[field];
        if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
        await applyClientSettingSideEffect(field, result.settings, context, true);
      }
    },
    refusal: "Could not reset those settings on this system.",
  });

  registerConnectionRows(dependencies);
}

/**
 * The Linear and calendar rows, proxied to the host that owns each grant: the
 * consent flows, the loopback redirects, the exchanges, the stored accounts
 * and selections, the renewals and the revocations all run there, and the
 * renderer's reply is the settings snapshot alone. The EventKit helper itself
 * runs here, at the host's ask through the native node, so the consent dialog
 * a connect raises is still raised on this machine by the press that asked for
 * it. The one address opened from here — the Privacy pane a row's press names
 * — is the client's own act.
 */
function registerConnectionRows(
  dependencies: Pick<
    SettingsRowsIpcDependencies,
    "ipcMain" | "trustedSender" | "registerSettingHandler" | "host" | "reporterOf" | "openExternal"
  >,
): void {
  const { ipcMain, trustedSender, registerSettingHandler, host, reporterOf, openExternal } =
    dependencies;
  registerSettingHandler(BRIDGE.connectLinear, {
    validate: () => undefined,
    save: (_value, context) => host.connectLinear(reporterOf(context)),
    refusal: "Could not connect Linear on this system.",
  });
  registerSettingHandler(BRIDGE.disconnectLinear, {
    validate: () => undefined,
    save: (_value, context) => host.disconnectLinear(reporterOf(context)),
    refusal: "Could not disconnect Linear on this system.",
  });
  registerSettingHandler(BRIDGE.connectGoogleCalendar, {
    validate: () => undefined,
    save: (_value, context) => host.connectGoogleCalendar(reporterOf(context)),
    refusal: "Could not connect Google Calendar on this system.",
  });
  registerSettingHandler(BRIDGE.removeCalendarAccount, {
    validate(accountId) {
      return accountId;
    },
    save: (accountId, context) => host.removeCalendarAccount(accountId, reporterOf(context)),
    refusal: "Could not disconnect that account on this system.",
  });
  registerSettingHandler(BRIDGE.connectAppleCalendar, {
    validate: () => undefined,
    save: (_value, context) => host.connectAppleCalendar(reporterOf(context)),
    refusal: "Could not connect Apple Calendar on this system.",
  });
  registerSettingHandler(BRIDGE.disconnectAppleCalendar, {
    validate: () => undefined,
    save: (_value, context) => host.disconnectAppleCalendar(reporterOf(context)),
    refusal: "Could not disconnect Apple Calendar on this system.",
  });
  registerSettingHandler(BRIDGE.setCalendarSelected, {
    validate(accountId, calendarId, selected) {
      return { accountId, calendarId, selected };
    },
    save: ({ accountId, calendarId, selected }, context) =>
      host.setCalendarSelected(accountId, calendarId, selected, reporterOf(context)),
    refusal: "Could not save that calendar choice on this system.",
  });
  registerBridge(
    BRIDGE,
    {
      cancelLinearSignIn: () => host.cancelLinearSignIn(),
      reopenLinearSignIn: () => host.reopenLinearSignIn(),
      cancelGoogleCalendarSignIn: () => host.cancelGoogleCalendarSignIn(),
      reopenGoogleCalendarSignIn: () => host.reopenGoogleCalendarSignIn(),
      cancelAppleCalendarConnect: () => host.cancelAppleCalendarConnect(),
      async appleCalendarAccessStatus() {
        return (await host.appleCalendarAccessStatus()) ?? APPLE_CALENDAR_ACCESS.NOT_DETERMINED;
      },
      refreshCalendars: () => host.refreshCalendars(),
      openCalendarSettings: () => openExternal(CALENDAR_PRIVACY_PANE_URL),
    },
    { ipcMain, trustedSender },
  );
}
