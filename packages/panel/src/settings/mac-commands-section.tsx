import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  settingRowsForPage,
} from "@luke/settings";
import {
  BUTTON_VARIANT,
  Button,
  ExternalIcon,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
} from "@luke/ui";
import { NOTIFICATIONS_STATUS, type NotificationsControl } from "@luke/voice/settings-controls";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/** What the line says where macOS refused Luke's last notification, by whether this is the packaged app. */
const NOTIFICATIONS_OFF_WORDS = {
  packaged:
    "macOS has notifications off for Luke, so a command waiting while Luke is behind won't say so.",
  development:
    "macOS has notifications off for Electron, which is how the dev build appears to macOS, so a command waiting while Luke is behind won't say so.",
} as const;

/** The line under the choice where macOS refused Luke's last notification, and the way to turn them back on. Note that it has no name of its own, because the choice above it is what it is about. */
function NotificationsOff({ control }: { control: NotificationsControl }): React.JSX.Element {
  return (
    <SettingsRow
      label={null}
      description={
        <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
          {control.packaged
            ? NOTIFICATIONS_OFF_WORDS.packaged
            : NOTIFICATIONS_OFF_WORDS.development}
        </SettingsRowStateLine>
      }
    >
      {() => (
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<ExternalIcon />}
          onClick={control.onOpenSettings}
        >
          Open System Settings
        </Button>
      )}
    </SettingsRow>
  );
}

/**
 * mac-commands-section.tsx -- the This Mac page's groups: whether Luke and coding agents may run shell commands here, then Startup.
 *
 * One choice, Ask every time by default: each command is put to the
 * developer before it runs, or every command runs unasked, or none at all
 * (`compose-mac-commands.ts` in the host stops reading for commands under
 * Never). A command waiting while Luke is behind is the one notification
 * Luke posts, so where macOS refused his last one a line under the choice
 * says so and opens System Settings, where they are turned back on; a
 * development build runs inside Electron's own app, which macOS lists it
 * as, and the line names it so. Startup holds whether Luke opens at login, since it is the Mac
 * that starts him; it stands only where the installed app does, so a page
 * with none of its rows draws no empty heading.
 */
export function MacCommandsSection({
  view,
  writes,
  notifications,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  notifications: NotificationsControl;
}): React.JSX.Element {
  const startup =
    settingRowsForPage(SCHEMA_SETTINGS_PAGE.THIS_MAC, SETTING_SECTION.STARTUP, view).length > 0;
  return (
    <>
      <SettingsSection>
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} writes={writes} />
        {notifications.status === NOTIFICATIONS_STATUS.OFF ? (
          <NotificationsOff control={notifications} />
        ) : null}
      </SettingsSection>
      {startup ? (
        <SettingsSection title="Startup">
          <SchemaSettingRows
            page={SCHEMA_SETTINGS_PAGE.THIS_MAC}
            section={SETTING_SECTION.STARTUP}
            view={view}
            writes={writes}
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
