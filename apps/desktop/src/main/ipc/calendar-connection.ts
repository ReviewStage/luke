import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { APPLE_CALENDAR_ACCESS } from "#shared/apple-calendar";
import { BRIDGE } from "#shared/bridge";
import type { HostOperator } from "../gateway/host-operator";
import type { BridgeContext } from "../register-bridge";
import { registerBridge } from "../register-bridge";
import type { createSettingsHandler } from "../settings-handler";

/**
 * The calendar rows, proxied to the host that owns the calendar policy: the
 * Google consent flow, the stored accounts and selections, the Apple
 * connection, and the passes all run there. The EventKit helper itself runs
 * here, at the host's ask through the native node, so the consent dialog the
 * connect raises is still raised on this machine by the press that asked for
 * it. The one address opened from here — the Privacy pane a row's press
 * names — is the client's own act.
 */
export interface CalendarConnectionIpcDependencies {
  ipcMain: Pick<IpcMain, "on" | "handle">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSetting: ReturnType<typeof createSettingsHandler>;
  host: HostOperator;
  reporterOf: (context: BridgeContext) => string;
  /** Opens a page in the default browser; the address lives in this file. */
  openExternal: (url: string) => void;
}

const CALENDAR_PRIVACY_PANE_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars";

export function registerCalendarConnectionIpc(
  dependencies: CalendarConnectionIpcDependencies,
): void {
  const { registerSetting, host, reporterOf, openExternal } = dependencies;
  registerSetting(BRIDGE.connectGoogleCalendar, {
    validate: () => undefined,
    save: (_value, context) => host.connectGoogleCalendar(reporterOf(context)),
    refusal: "Could not connect Google Calendar on this system.",
  });
  registerSetting(BRIDGE.removeCalendarAccount, {
    validate(accountId) {
      return accountId;
    },
    save: (accountId, context) => host.removeCalendarAccount(accountId, reporterOf(context)),
    refusal: "Could not disconnect that account on this system.",
  });
  registerSetting(BRIDGE.connectAppleCalendar, {
    validate: () => undefined,
    save: (_value, context) => host.connectAppleCalendar(reporterOf(context)),
    refusal: "Could not connect Apple Calendar on this system.",
  });
  registerSetting(BRIDGE.disconnectAppleCalendar, {
    validate: () => undefined,
    save: (_value, context) => host.disconnectAppleCalendar(reporterOf(context)),
    refusal: "Could not disconnect Apple Calendar on this system.",
  });
  registerBridge(
    BRIDGE,
    {
      cancelGoogleCalendarSignIn: () => host.cancelGoogleCalendarSignIn(),
      reopenGoogleCalendarSignIn: () => host.reopenGoogleCalendarSignIn(),
      cancelAppleCalendarConnect: () => host.cancelAppleCalendarConnect(),
      async appleCalendarAccessStatus() {
        return (await host.appleCalendarAccessStatus()) ?? APPLE_CALENDAR_ACCESS.NOT_DETERMINED;
      },
      refreshCalendars: () => host.refreshCalendars(),
      openCalendarSettings: () => openExternal(CALENDAR_PRIVACY_PANE_URL),
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
  registerSetting(BRIDGE.setCalendarSelected, {
    validate(accountId, calendarId, selected) {
      return { accountId, calendarId, selected };
    },
    save: ({ accountId, calendarId, selected }, context) =>
      host.setCalendarSelected(accountId, calendarId, selected, reporterOf(context)),
    refusal: "Could not save that calendar choice on this system.",
  });
}
