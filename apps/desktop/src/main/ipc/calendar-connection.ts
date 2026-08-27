import {
  PRODUCT_CALENDAR_SOURCE,
  PRODUCT_EVENT,
  PRODUCT_SETTING_VALUE,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { GoogleCalendarReader, GoogleCalendarSignIn } from "@sidecar/calendar";
import { APP_SETTING_ID } from "@sidecar/guide";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { APPLE_CALENDAR_ACCESS } from "#shared/apple-calendar";
import { BRIDGE } from "#shared/bridge";
import type { ObservedAccountCalendars } from "#shared/contracts";
import { APPLE_CALENDAR_ACCESS_REFUSAL, type AppleCalendarReader } from "../apple-calendar";
import { registerBridge } from "../register-bridge";
import { type createSettingsHandler, SettingsRefusal } from "../settings-handler";
import type { SettingsStore } from "../settings-store";

export interface CalendarConnectionIpcDependencies {
  ipcMain: Pick<IpcMain, "on" | "handle">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSetting: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  calendar: GoogleCalendarReader;
  signIn: GoogleCalendarSignIn;
  appleCalendar: AppleCalendarReader;
  observedCalendars: () => readonly ObservedAccountCalendars[];
  /** One observation pass, run now; fire-and-forget callers `void` it. */
  refresh: () => Promise<void>;
  /** Opens a page in the default browser; the addresses live in this file. */
  openExternal: (url: string) => void;
  recordProductEvent: RecordProductEvent;
  /**
   * A connect actually stored a connection, from either source — the one
   * edge that settles the onboarding gate, reported beside the count that
   * shares its terms.
   */
  calendarConnected: () => void;
}

const CALENDAR_PRIVACY_PANE_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars";

export function registerCalendarConnectionIpc(
  dependencies: CalendarConnectionIpcDependencies,
): void {
  const {
    registerSetting,
    settingsStore,
    calendar,
    signIn,
    appleCalendar,
    refresh,
    openExternal,
    recordProductEvent,
    calendarConnected,
  } = dependencies;
  registerSetting(BRIDGE.connectGoogleCalendar, {
    validate: () => undefined,
    async save() {
      const outcome = await signIn.signIn();
      if ("reason" in outcome) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          settings: await settingsStore.snapshot(),
          reason: outcome.reason,
        };
      }
      let primaryId: string | undefined;
      try {
        const calendars = await calendar.listCalendars(outcome.accessToken);
        primaryId = (calendars.find((candidate) => candidate.primary) ?? calendars[0])?.id;
      } catch {
        primaryId = undefined;
      }
      if (!primaryId) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          settings: await settingsStore.snapshot(),
          reason: "Google did not answer with the account's calendars.",
        };
      }
      return settingsStore.addCalendarAccount(primaryId, outcome.refreshToken, [primaryId]);
    },
    apply(result) {
      if (!result.reason) {
        void refresh();
        recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
          calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
        });
        calendarConnected();
      }
    },
    refusal: "Could not connect Google Calendar on this system.",
  });
  registerSetting(BRIDGE.removeCalendarAccount, {
    validate(accountId) {
      return accountId;
    },
    save: (accountId) => settingsStore.removeCalendarAccount(accountId),
    apply(result) {
      if (!result.reason) {
        void refresh();
        recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
          calendar_source: PRODUCT_CALENDAR_SOURCE.GOOGLE,
        });
      }
    },
    refusal: "Could not disconnect that account on this system.",
  });
  // Which connect attempt is current: a new attempt or a cancel supersedes
  // any older wait, so a switch flipped minutes after giving up cannot land
  // a connection nobody is watching for.
  let appleConnectGeneration = 0;
  // Whether the save that just ran actually stored a grant. Neither half of
  // the result answers it: a superseded wait returns the snapshot with no
  // reason at all, and a snapshot already carrying a connection cannot say
  // whether this attempt is what put it there.
  let appleConnectStored = false;
  registerSetting(BRIDGE.connectAppleCalendar, {
    validate: () => undefined,
    async save() {
      const generation = ++appleConnectGeneration;
      appleConnectStored = false;
      // The system's own consent is the whole connect flow: no browser, no
      // loopback, no token to store. What comes back seeds the choice the
      // way Google's primary calendar seeds an account's — the calendar new
      // events land on, else the first the Mac lists.
      const outcome = await appleCalendar.obtainAccess({
        openSystemSettings: () => openExternal(CALENDAR_PRIVACY_PANE_URL),
        superseded: () => appleConnectGeneration !== generation,
      });
      // An Allow that arrived after the cancel stores nothing: the grant is
      // macOS's own to keep, but the connection waits for the next Connect.
      // A cancel is the user's own act, so it carries no refusal to show.
      if (appleConnectGeneration !== generation) {
        return { status: ACT_RESULT_STATUS.ACCEPTED, settings: await settingsStore.snapshot() };
      }
      if (outcome.access !== APPLE_CALENDAR_ACCESS.FULL) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          settings: await settingsStore.snapshot(),
          // An ask that failed on its own says why; a no left standing gets
          // the sentence that says where the grant lives.
          reason: outcome.failure ?? APPLE_CALENDAR_ACCESS_REFUSAL[outcome.access],
        };
      }
      const seed = outcome.defaultCalendarId ?? outcome.calendars[0]?.id;
      appleConnectStored = true;
      return settingsStore.connectAppleCalendar(seed ? [seed] : []);
    },
    apply(result) {
      if (result.reason) return;
      void refresh();
      if (appleConnectStored) {
        recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {
          calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
        });
        calendarConnected();
      }
    },
    refusal: "Could not connect Apple Calendar on this system.",
  });
  registerSetting(BRIDGE.disconnectAppleCalendar, {
    validate: () => undefined,
    save: () => settingsStore.disconnectAppleCalendar(),
    apply(result) {
      if (!result.reason) {
        void refresh();
        recordProductEvent(PRODUCT_EVENT.CALENDAR_DISCONNECT, {
          calendar_source: PRODUCT_CALENDAR_SOURCE.APPLE,
        });
      }
    },
    refusal: "Could not disconnect Apple Calendar on this system.",
  });
  // A read, not a settings write: how far macOS currently lets the calendar
  // read go, so the panel stands down only for a dialog that will appear. A
  // probe that cannot answer reads as not yet asked — the connect then runs
  // the full consent flow, whose own answer is the honest one.
  registerBridge(
    BRIDGE,
    {
      cancelGoogleCalendarSignIn: signIn.cancel.bind(signIn),
      reopenGoogleCalendarSignIn: signIn.reopen.bind(signIn),
      cancelAppleCalendarConnect() {
        appleConnectGeneration += 1;
      },
      async appleCalendarAccessStatus() {
        try {
          return await appleCalendar.status();
        } catch {
          return APPLE_CALENDAR_ACCESS.NOT_DETERMINED;
        }
      },
      refreshCalendars: refresh,
      openCalendarSettings: () => openExternal(CALENDAR_PRIVACY_PANE_URL),
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
  registerSetting(BRIDGE.setCalendarSelected, {
    async validate(accountId, calendarId, selected) {
      if (
        selected &&
        !dependencies
          .observedCalendars()
          .find((account) => account.accountId === accountId)
          ?.calendars.some((candidate) => candidate.id === calendarId)
      ) {
        return new SettingsRefusal({
          status: ACT_RESULT_STATUS.REJECTED,
          settings: await settingsStore.snapshot(),
          reason: "That calendar is not one the account's latest list offered.",
        });
      }
      return { accountId, calendarId, selected };
    },
    save: ({ accountId, calendarId, selected }) =>
      settingsStore.setCalendarSelected(accountId, calendarId, selected),
    apply(result, { selected }) {
      if (result.reason) return;
      void refresh();
      // Which calendar, and whose account, never travel: the switch went on
      // or off is the whole of it. This one is counted here rather than by
      // the settings rows' own recorder because the choice lives on the
      // calendar rows rather than in the settings schema.
      recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
        setting_id: APP_SETTING_ID.CALENDAR_SELECTED,
        setting_value: selected ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF,
      });
    },
    refusal: "Could not save that calendar choice on this system.",
  });
}
