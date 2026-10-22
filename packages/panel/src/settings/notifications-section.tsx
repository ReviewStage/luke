import { SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE, type SettingsRowsInput } from "@luke/settings";
import { BUTTON_VARIANT, Button, ExternalIcon, SettingsRow, SettingsSection } from "@luke/ui";
import {
  NOTIFICATIONS_GRANTOR,
  NOTIFICATIONS_STATUS,
  type NotificationsControl,
} from "@luke/voice/settings-controls";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/**
 * What the section says of when Luke notifies at all and of the grant: of
 * macOS's, by whether this is the packaged app, or of the browser's
 * permission for the site.
 */
const NOTIFICATIONS_WORDS = {
  packaged: {
    when: "Luke notifies only when its window is in the background.",
    on: "macOS showed Luke's last notification, so notifications are on.",
    off: "macOS has notifications off for Luke.",
  },
  development: {
    when: "Luke notifies only when its window is in the background.",
    on: "macOS showed the last notification from Electron, which is how the dev build appears to macOS.",
    off: "macOS has notifications off for Electron, which is how the dev build appears to macOS.",
  },
  browser: {
    when: "Luke notifies only while its tab is hidden.",
    on: "Your browser lets Luke show notifications.",
    off: "Your browser blocks Luke's notifications. Allow them in this site's settings, beside its address.",
  },
} as const;

/** The words for the grant this panel stands under. */
function notificationsWords(
  control: NotificationsControl,
): (typeof NOTIFICATIONS_WORDS)[keyof typeof NOTIFICATIONS_WORDS] {
  if (control.grantor === NOTIFICATIONS_GRANTOR.BROWSER) return NOTIFICATIONS_WORDS.browser;
  return control.packaged ? NOTIFICATIONS_WORDS.packaged : NOTIFICATIONS_WORDS.development;
}

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
 * the line names it so. In a browser the grant is the site's permission,
 * which the page cannot open, so the refusal says where it is changed and
 * offers no button.
 *
 * The group is `@luke/ui`'s `SettingsSection` and each line its
 * `SettingsRow`, the test and System Settings presses the outline `Button`.
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
  const words = notificationsWords(control);
  const opensSettings = control.grantor === NOTIFICATIONS_GRANTOR.MACOS;
  return (
    <SettingsSection>
      <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.NOTIFICATIONS} view={view} writes={writes} />
      <SettingsRow
        label="Test notification"
        description={
          <>
            {words.when}
            {control.status === NOTIFICATIONS_STATUS.ON ? (
              <span className="settings-state settings-state-line" data-state="connected">
                {words.on}
              </span>
            ) : null}
          </>
        }
      >
        {() => (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={control.onTest}>
            Send test notification
          </Button>
        )}
      </SettingsRow>
      {/* Note that the refusal's row is its line alone, with no name of its
          own, because the test row above already names what it is about. */}
      {control.status === NOTIFICATIONS_STATUS.OFF ? (
        <SettingsRow
          label={null}
          description={
            <span className="settings-state" data-state="attention">
              {words.off}
            </span>
          }
        >
          {opensSettings
            ? () => (
                <Button
                  variant={BUTTON_VARIANT.OUTLINE}
                  icon={<ExternalIcon />}
                  onClick={control.onOpenSettings}
                >
                  Open System Settings
                </Button>
              )
            : undefined}
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
