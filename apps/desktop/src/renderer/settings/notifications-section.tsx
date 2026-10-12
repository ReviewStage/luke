import { BellIcon, ExternalIcon } from "@sidecar/panel";
import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@sidecar/settings";
import type { NotificationsControl } from "./controls";
import { SchemaSettingRows } from "./schema-rows";
import type { SettingsWrites } from "./writes";

/** What the row says while macOS refuses Luke's notifications. */
export const NOTIFICATIONS_REFUSED_NOTE = "Notifications are off for Luke in System Settings.";

/**
 * Whether Luke posts a notification as a coding agent ends behind his
 * window, standing on the front page. While macOS refuses them the switch
 * alone would be a promise nothing keeps, so a quiet line under it says
 * where they are turned back on, and takes the developer there; it stands
 * only while the switch is on, as off needs nothing from macOS.
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
  return (
    <section className="settings-section">
      <h2>
        <BellIcon />
        Notifications
      </h2>
      <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.ROOT} view={view} writes={writes} />
      {control.refused && view.settings.agentNotifications ? (
        <div className="settings-row">
          <span className="settings-copy">
            <small>{NOTIFICATIONS_REFUSED_NOTE}</small>
          </span>
          <button type="button" className="toolbar-button" onClick={control.onOpenSettings}>
            Open System Settings
            <ExternalIcon />
          </button>
        </div>
      ) : null}
    </section>
  );
}
