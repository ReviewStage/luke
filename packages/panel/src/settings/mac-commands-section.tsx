import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
  settingRowsForPage,
} from "@repo/settings";
import { NOTIFICATIONS_STATUS, type NotificationsControl } from "@repo/settings/settings-controls";
import {
  BUTTON_VARIANT,
  Button,
  ExternalIcon,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
} from "@repo/ui";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

const NOTIFICATIONS_OFF_WORDS = {
  packaged: `macOS has notifications off for ${PRODUCT_NAME}, so a command waiting while ${PRODUCT_NAME} is behind won't say so.`,
  development: `macOS has notifications off for Electron, which is how the dev build appears to macOS, so a command waiting while ${PRODUCT_NAME} is behind won't say so.`,
} as const;

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
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.THIS_MAC} view={view} />
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
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
