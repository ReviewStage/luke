import {
  isWireString,
  PRODUCT_EVENT,
  type RecordProductEvent,
  type UnparsedWireValue,
} from "@sidecar/core";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { runDesktopEffect } from "../effect-runtime";
import type { GoogleCalendarReader } from "../google-calendar";
import type { GoogleCalendarSignIn } from "../google-calendar-oauth";
import { type createSettingsHandler, SettingsRefusal } from "../settings-handler";
import type { SettingsStore } from "../settings-store";
import { channels, type ObservedAccountCalendars } from "../shared/contracts";

export interface CalendarConnectionIpcDependencies {
  ipcMain: Pick<IpcMain, "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSetting: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  calendar: GoogleCalendarReader;
  signIn: GoogleCalendarSignIn;
  observedCalendars: () => readonly ObservedAccountCalendars[];
  refresh: () => void;
  recordProductEvent: RecordProductEvent;
}

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
    refresh,
    recordProductEvent,
  } = dependencies;
  registerSetting(channels.connectGoogleCalendar, {
    validate: () => undefined,
    async save() {
      const outcome = await runDesktopEffect(signIn.signIn());
      if ("reason" in outcome) {
        return { settings: await settingsStore.snapshot(), reason: outcome.reason };
      }
      let primaryId: string | undefined;
      try {
        const calendars = await runDesktopEffect(calendar.listCalendars(outcome.accessToken));
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
        refresh();
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
      if (!result.reason) refresh();
    },
    refusal: "Could not disconnect that account on this system.",
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
          reason: "That calendar is not one Google listed for the account.",
        });
      }
      return { accountId, calendarId, selected };
    },
    save: ({ accountId, calendarId, selected }) =>
      settingsStore.setCalendarSelected(accountId, calendarId, selected),
    apply(result) {
      if (!result.reason) refresh();
    },
    refusal: "Could not save that calendar choice on this system.",
  });
}
