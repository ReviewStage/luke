import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@luke/settings";
import { ExternalIcon } from "@luke/ui";
import { NOTIFICATIONS_STATUS, type NotificationsControl } from "@luke/voice/settings-controls";
import { SchemaSettingRows } from "./schema-rows";
import { SettingsGroup } from "./settings-group";
import type { SettingsWrites } from "./writes";

/** What the test row says of when Luke notifies at all. */
const NOTIFICATIONS_WHEN_NOTE = "Luke notifies only when its window is in the background.";

/** What the section says of macOS's grant, by whether this is the packaged app. */
const NOTIFICATIONS_LINE = {
  packaged: {
    on: "macOS showed Luke's last notification, so notifications are on.",
    off: "macOS has notifications off for Luke.",
  },
  development: {
    on: "macOS showed the last notification from Electron, which is how the dev build appears to macOS.",
    off: "macOS has notifications off for Electron, which is how the dev build appears to macOS.",
  },
} as const;

/**
 * Whether Luke posts a notification as a coding agent ends behind his
 * window, a notification posted now to learn whether macOS shows them, and
 * what macOS last answered: the Notifications page's one group. Nothing is
 * said until macOS has shown or refused one; once it refused, a line says so
 * and takes the developer to where they are turned back on. Note that a
 * shown one is told as the last notification shown rather than as the grant
 * standing now, because a change in System Settings posts nothing Electron
 * hears, and the test is how the developer asks again. A development
 * build runs inside Electron's own app, so macOS lists it as Electron, and
 * the line names it so.
 */
export function NotificationsSection({
  view,
  writes,
  control,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  control: NotificationsControl;
}): React.JSX.Element {
  const line = control.packaged ? NOTIFICATIONS_LINE.packaged : NOTIFICATIONS_LINE.development;
  return (
    <SettingsGroup>
      <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.NOTIFICATIONS} view={view} writes={writes} />
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Test notification</strong>
          <small>{NOTIFICATIONS_WHEN_NOTE}</small>
          {control.status === NOTIFICATIONS_STATUS.ON ? (
            <small className="settings-state" data-state="connected">
              {line.on}
            </small>
          ) : null}
        </span>
        <button type="button" className="toolbar-button bordered-button" onClick={control.onTest}>
          Send test notification
        </button>
      </div>
      {control.status === NOTIFICATIONS_STATUS.OFF ? (
        <div className="settings-row">
          <span className="settings-copy">
            <small className="settings-state" data-state="attention">
              {line.off}
            </small>
          </span>
          <button
            type="button"
            className="toolbar-button bordered-button"
            onClick={control.onOpenSettings}
          >
            Open System Settings
            <ExternalIcon />
          </button>
        </div>
      ) : null}
    </SettingsGroup>
  );
}
