import { APPLE_CALENDAR_ACCESS, CALENDAR_PRIVACY_PANE_URL } from "@sidecar/calendar/vocabulary";
import { VOICE_CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  SETTING_SIDE_EFFECT,
} from "@sidecar/settings";
import type { AppSettings, SettingsUpdateResult } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, type SettingUpdatePayload } from "#shared/messages/acts";
import type { ActRows } from "../act-router";
import type { HostOperator } from "../gateway/host-operator";
import type { MediaDuckController } from "../native/media-duck";
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
export interface SettingsRowsDependencies {
  host: HostOperator;
  /** The opaque token naming the window that asked, so the host's change event is not echoed back to it. */
  reporterOf: (sender: WebContents) => string;
  /** The settings snapshot as this client last saw it, for the refusals worded here. */
  lastSettings: () => AppSettings | undefined;
  hotkeys: HotkeyRegistrar;
  dock: DockPresence;
  applyLoginItem: (openAtLogin: boolean) => void;
  panels: PanelManager;
  mediaDuck: MediaDuckController;
  /** Opens a page in the default browser; the address lives in this file. */
  openExternal: (url: string) => void;
}

/** Which kinds this file answers for: the settings writes and the connection rows beside them. */
type SettingsActKind =
  | typeof ACT_KIND.SETTING_UPDATE
  | typeof ACT_KIND.SETTING_UPDATE_ENTRY
  | typeof ACT_KIND.SETTINGS_RESET
  | typeof ACT_KIND.CREDENTIAL_SET_API_KEY
  | typeof ACT_KIND.CALENDAR_CONNECT_GOOGLE
  | typeof ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN
  | typeof ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN
  | typeof ACT_KIND.CALENDAR_REMOVE_ACCOUNT
  | typeof ACT_KIND.CALENDAR_CONNECT_APPLE
  | typeof ACT_KIND.CALENDAR_DISCONNECT_APPLE
  | typeof ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS
  | typeof ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT
  | typeof ACT_KIND.CALENDAR_OPEN_SETTINGS
  | typeof ACT_KIND.CALENDAR_REFRESH
  | typeof ACT_KIND.CALENDAR_SET_SELECTED
  | typeof ACT_KIND.TRACKER_CONNECT
  | typeof ACT_KIND.TRACKER_CANCEL_SIGN_IN
  | typeof ACT_KIND.TRACKER_REOPEN_SIGN_IN
  | typeof ACT_KIND.TRACKER_DISCONNECT;

/** How every settings row below answers: a write carried, or a refusal the row can draw. */
interface SettingsWriter {
  /**
   * One settings write. The host's change event is what every other window
   * hears; the window that asked hears this answer and is skipped there. A
   * host that could not be reached at all is refused over the last snapshot
   * this client saw, worded by the act's own sentence, and only a client with
   * no snapshot either throws — which the router then answers as that same
   * sentence, without the settings the row would have redrawn from.
   */
  write(
    kind: SettingsActKind,
    save: () => Promise<SettingsUpdateResult>,
    apply?: (result: SettingsUpdateResult) => Promise<void> | void,
  ): Promise<SettingsUpdateResult>;
  /** A refusal decided here rather than by the host: the settings as they stand, and why. */
  refuse(reason: string): Promise<SettingsUpdateResult>;
}

function settingsWriter(
  dependencies: Pick<SettingsRowsDependencies, "host" | "lastSettings">,
): SettingsWriter {
  const refuse = async (reason: string): Promise<SettingsUpdateResult> => {
    const settings = dependencies.lastSettings() ?? (await dependencies.host.settingsSnapshot());
    if (!settings) throw new Error(reason);
    return { status: ACTION_RESULT_STATUS.REJECTED, settings, reason };
  };
  return {
    refuse,
    async write(kind, save, apply) {
      try {
        const saved = await save();
        // The apply is inside the same reach as the write: a side effect this
        // process could not carry leaves the row's switch describing
        // something that did not happen, so the row is answered a refusal it
        // can redraw from rather than a write that only half landed.
        await apply?.(saved);
        return saved;
      } catch {
        return refuse(ACT[kind].refusal);
      }
    },
  };
}

export function settingsActRows(
  dependencies: SettingsRowsDependencies,
): Pick<ActRows, SettingsActKind> {
  const { host, reporterOf, hotkeys, dock, applyLoginItem, panels, mediaDuck } = dependencies;
  const { write, refuse } = settingsWriter(dependencies);

  /** The side effects this process has hands on; the host applied its own before answering. */
  async function applyClientSettingSideEffect(
    field: AppSettingField,
    settings: AppSettings,
    sender: WebContents,
    waitForDeferredEffects = false,
  ): Promise<void> {
    switch (APP_SETTING_SCHEMA[field].mainProcessSideEffect) {
      case SETTING_SIDE_EFFECT.LOGIN_ITEM:
        applyLoginItem(settings.stored.openAtLogin);
        break;
      case SETTING_SIDE_EFFECT.DOCK:
        dock.apply(settings.stored.showInDock, panels.displayIdFor(sender));
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

  /**
   * Which key a chord this write would claim is already spoken for, named the
   * way the row will draw it. Read from the payload rather than a field and a
   * value apart, because it is the field that says the value is a chord.
   */
  const chordHolder = (payload: SettingUpdatePayload): string | undefined => {
    if (payload.field === APP_SETTING_SCHEMA.askHotkey.field) {
      if (payload.value === undefined) return undefined;
      return hotkeys.reserve(payload.value, HOTKEY_RANK.ASK) === HOTKEY_RANK.TALK
        ? "talk"
        : undefined;
    }
    if (payload.field !== APP_SETTING_SCHEMA.stopHotkey.field) return undefined;
    if (payload.value === undefined) return undefined;
    const owner = hotkeys.reserve(payload.value, HOTKEY_RANK.STOP);
    if (owner === HOTKEY_RANK.TALK) return "talk";
    return owner === HOTKEY_RANK.ASK ? "ask" : undefined;
  };

  return {
    // The renderer can replace or clear a provider's credential but never
    // reads it back; the reply reports only where each key now comes from,
    // and the key itself crosses once, to the host that keeps it.
    [ACT_KIND.CREDENTIAL_SET_API_KEY]: ({ providerId, apiKey }, { sender }) =>
      write(
        ACT_KIND.CREDENTIAL_SET_API_KEY,
        () => host.setProviderApiKey(providerId, apiKey, reporterOf(sender)),
        async (result) => {
          // The voice key is what the talk key is claimed for: once the host
          // has rebuilt the voice on it, the key moves — claimed now that
          // there is something to talk to, or given back now that there is not.
          if (!result.reason && providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
            await hotkeys.reapply(HOTKEY_RANK.TALK);
          }
        },
      ),
    [ACT_KIND.SETTING_UPDATE]: async (payload, { sender }) => {
      const holder = chordHolder(payload);
      if (holder) return refuse(`That chord is reserved for the ${holder} key.`);
      return write(
        ACT_KIND.SETTING_UPDATE,
        // SAFETY: the act's own schema parsed this value for this field.
        () => host.updateSetting(payload.field, payload.value as never, reporterOf(sender)),
        async (result) => {
          if (result.reason) return;
          await applyClientSettingSideEffect(payload.field, result.settings, sender);
        },
      );
    },
    [ACT_KIND.SETTING_UPDATE_ENTRY]: ({ field, key, value }, { sender }) =>
      write(
        ACT_KIND.SETTING_UPDATE_ENTRY,
        // SAFETY: the act's own schema parsed this value for this field and key.
        () => host.updateSettingEntry(field, key, value as never, reporterOf(sender)),
        async (result) => {
          if (result.reason) return;
          await applyClientSettingSideEffect(field, result.settings, sender);
        },
      ),
    [ACT_KIND.SETTINGS_RESET]: ({ scope }, { sender }) =>
      write(
        ACT_KIND.SETTINGS_RESET,
        () => host.resetSettings(scope, reporterOf(sender)),
        async (result) => {
          if (result.reason) return;
          for (const field of APP_SETTING_FIELDS) {
            const definition = APP_SETTING_SCHEMA[field];
            if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
            await applyClientSettingSideEffect(field, result.settings, sender, true);
          }
        },
      ),
    ...connectionActRows(dependencies),
  };
}

/** Which kinds the connection rows below answer for. */
type ConnectionActKind = Exclude<
  SettingsActKind,
  | typeof ACT_KIND.SETTING_UPDATE
  | typeof ACT_KIND.SETTING_UPDATE_ENTRY
  | typeof ACT_KIND.SETTINGS_RESET
  | typeof ACT_KIND.CREDENTIAL_SET_API_KEY
>;

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
function connectionActRows(
  dependencies: Pick<
    SettingsRowsDependencies,
    "host" | "reporterOf" | "lastSettings" | "openExternal"
  >,
): Pick<ActRows, ConnectionActKind> {
  const { host, reporterOf, openExternal } = dependencies;
  const { write } = settingsWriter(dependencies);
  return {
    [ACT_KIND.TRACKER_CONNECT]: (_payload, { sender }) =>
      write(ACT_KIND.TRACKER_CONNECT, () => host.connectLinear(reporterOf(sender))),
    [ACT_KIND.TRACKER_DISCONNECT]: (_payload, { sender }) =>
      write(ACT_KIND.TRACKER_DISCONNECT, () => host.disconnectLinear(reporterOf(sender))),
    [ACT_KIND.TRACKER_CANCEL_SIGN_IN]: () => host.cancelLinearSignIn(),
    [ACT_KIND.TRACKER_REOPEN_SIGN_IN]: () => host.reopenLinearSignIn(),
    [ACT_KIND.CALENDAR_CONNECT_GOOGLE]: (_payload, { sender }) =>
      write(ACT_KIND.CALENDAR_CONNECT_GOOGLE, () => host.connectGoogleCalendar(reporterOf(sender))),
    [ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: () => host.cancelGoogleCalendarSignIn(),
    [ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: () => host.reopenGoogleCalendarSignIn(),
    [ACT_KIND.CALENDAR_REMOVE_ACCOUNT]: ({ accountId }, { sender }) =>
      write(ACT_KIND.CALENDAR_REMOVE_ACCOUNT, () =>
        host.removeCalendarAccount(accountId, reporterOf(sender)),
      ),
    [ACT_KIND.CALENDAR_CONNECT_APPLE]: (_payload, { sender }) =>
      write(ACT_KIND.CALENDAR_CONNECT_APPLE, () => host.connectAppleCalendar(reporterOf(sender))),
    [ACT_KIND.CALENDAR_DISCONNECT_APPLE]: (_payload, { sender }) =>
      write(ACT_KIND.CALENDAR_DISCONNECT_APPLE, () =>
        host.disconnectAppleCalendar(reporterOf(sender)),
      ),
    [ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT]: () => host.cancelAppleCalendarConnect(),
    [ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS]: async () =>
      (await host.appleCalendarAccessStatus()) ?? APPLE_CALENDAR_ACCESS.NOT_DETERMINED,
    [ACT_KIND.CALENDAR_REFRESH]: () => host.refreshCalendars(),
    [ACT_KIND.CALENDAR_OPEN_SETTINGS]: () => openExternal(CALENDAR_PRIVACY_PANE_URL),
    [ACT_KIND.CALENDAR_SET_SELECTED]: ({ accountId, calendarId, selected }, { sender }) =>
      write(ACT_KIND.CALENDAR_SET_SELECTED, () =>
        host.setCalendarSelected(accountId, calendarId, selected, reporterOf(sender)),
      ),
  };
}
