import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import type { GoogleCalendarReader, GoogleCalendarSignIn } from "@sidecar/calendar";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { APPLE_CALENDAR_ACCESS } from "#shared/apple-calendar";
import { channels, type ObservedAccountCalendars } from "#shared/contracts";
import { APPLE_CALENDAR_ACCESS_REFUSAL, type AppleCalendarReader } from "../apple-calendar";
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
}

const CALENDAR_PRIVACY_PANE_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars";

export function registerCalendarConnectionIpc(
  dependencies: CalendarConnectionIpcDependencies,
): void {
  const {
    ipcMain,
    trustedSender,
    registerSetting,
    settingsStore,
    calendar,
    signIn,
    appleCalendar,
    refresh,
    openExternal,
    recordProductEvent,
  } = dependencies;
  registerSetting(channels.connectGoogleCalendar, {
    validate: () => undefined,
    async save() {
      const outcome = await signIn.signIn();
      if ("reason" in outcome) {
        return { settings: await settingsStore.snapshot(), reason: outcome.reason };
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
          settings: await settingsStore.snapshot(),
          reason: "Google did not answer with the account's calendars.",
        };
      }
      return settingsStore.addCalendarAccount(primaryId, outcome.refreshToken, [primaryId]);
    },
    apply(result) {
      if (!result.reason) {
        void refresh();
        recordProductEvent(PRODUCT_EVENT.CALENDAR_CONNECT, {});
      }
    },
    refusal: "Could not connect Google Calendar on this system.",
  });
  ipcMain.on(channels.cancelGoogleCalendarSignIn, (event) => {
    if (trustedSender(event)) signIn.cancel();
  });
  ipcMain.on(channels.reopenGoogleCalendarSignIn, (event) => {
    if (trustedSender(event)) signIn.reopen();
  });
  registerSetting(channels.removeCalendarAccount, {
    validate(accountId: UnparsedWireValue) {
      if (!isWireString(accountId) || !accountId) {
        throw new Error("Invalid calendar account request");
      }
      return accountId;
    },
    save: (accountId) => settingsStore.removeCalendarAccount(accountId),
    apply(result) {
      if (!result.reason) void refresh();
    },
    refusal: "Could not disconnect that account on this system.",
  });
  // Which connect attempt is current: a new attempt or a cancel supersedes
  // any older wait, so a switch flipped minutes after giving up cannot land
  // a connection nobody is watching for.
  let appleConnectGeneration = 0;
  registerSetting(channels.connectAppleCalendar, {
    validate: () => undefined,
    async save() {
      const generation = ++appleConnectGeneration;
      // The system's own consent is the whole connect flow: no browser, no
      // loopback, no token to store. What comes back seeds the choice the
      // way Google's primary calendar seeds an account's — the calendar new
      // events land on, else the first the Mac lists.
      const outcome = await appleCalendar.obtainAccess({
        openSystemSettings: () => openExternal(CALENDAR_PRIVACY_PANE_URL),
        superseded: () => appleConnectGeneration !== generation,
      });
      if (outcome.access !== APPLE_CALENDAR_ACCESS.FULL) {
        return {
          settings: await settingsStore.snapshot(),
          // An ask that failed on its own says why; a no left standing gets
          // the sentence that says where the grant lives.
          reason: outcome.failure ?? APPLE_CALENDAR_ACCESS_REFUSAL[outcome.access],
        };
      }
      const seed = outcome.defaultCalendarId ?? outcome.calendars[0]?.id;
      return settingsStore.connectAppleCalendar(seed ? [seed] : []);
    },
    apply(result) {
      if (!result.reason) void refresh();
    },
    refusal: "Could not connect Apple Calendar on this system.",
  });
  ipcMain.on(channels.cancelAppleCalendarConnect, (event) => {
    if (!trustedSender(event)) return;
    // The wait ends where it stands; a switch flipped after this lands
    // nothing until the next Connect.
    appleConnectGeneration += 1;
  });
  registerSetting(channels.disconnectAppleCalendar, {
    validate: () => undefined,
    save: () => settingsStore.disconnectAppleCalendar(),
    apply(result) {
      if (!result.reason) void refresh();
    },
    refusal: "Could not disconnect Apple Calendar on this system.",
  });
  // A read, not a settings write: how far macOS currently lets the calendar
  // read go, so the panel stands down only for a dialog that will appear. A
  // probe that cannot answer reads as not yet asked — the connect then runs
  // the full consent flow, whose own answer is the honest one.
  ipcMain.handle(channels.appleCalendarAccessStatus, async (event) => {
    if (!trustedSender(event)) return APPLE_CALENDAR_ACCESS.NOT_DETERMINED;
    try {
      return await appleCalendar.status();
    } catch {
      return APPLE_CALENDAR_ACCESS.NOT_DETERMINED;
    }
  });
  // The user's own "look again": one observation pass, run now, so a
  // calendar created a moment ago appears without waiting out the interval.
  // The same read-only pass the timer runs, and nothing more.
  ipcMain.handle(channels.refreshCalendars, async (event) => {
    if (!trustedSender(event)) return;
    await refresh();
  });
  // The pane where the system's own calendar grant lives: a denied ask can
  // only be undone there. The address is fixed by this build, on the
  // microphone opener's exact terms.
  ipcMain.on(channels.openCalendarSettings, (event) => {
    if (!trustedSender(event)) return;
    openExternal(CALENDAR_PRIVACY_PANE_URL);
  });
  registerSetting(channels.setCalendarSelected, {
    async validate(
      accountId: UnparsedWireValue,
      calendarId: UnparsedWireValue,
      selected: UnparsedWireValue,
    ) {
      if (!isWireString(accountId) || !accountId) {
        throw new Error("Invalid calendar selection request");
      }
      if (!isWireString(calendarId) || !calendarId) {
        throw new Error("Invalid calendar selection request");
      }
      if (selected !== true && selected !== false)
        throw new Error("Invalid calendar selection request");
      if (
        selected &&
        !dependencies
          .observedCalendars()
          .find((account) => account.accountId === accountId)
          ?.calendars.some((candidate) => candidate.id === calendarId)
      ) {
        return new SettingsRefusal({
          settings: await settingsStore.snapshot(),
          reason: "That calendar is not one the account's latest list offered.",
        });
      }
      return { accountId, calendarId, selected };
    },
    save: ({ accountId, calendarId, selected }) =>
      settingsStore.setCalendarSelected(accountId, calendarId, selected),
    apply(result) {
      if (!result.reason) void refresh();
    },
    refusal: "Could not save that calendar choice on this system.",
  });
}
