import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@repo/settings";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import type { MicrophoneControl } from "@repo/settings/settings-controls";
import {
  BUTTON_VARIANT,
  Button,
  CheckIcon,
  ExternalIcon,
  GAP,
  IconButton,
  Inline,
  SettingsRow,
  SettingsSection,
  Tooltip,
} from "@repo/ui";
import { microphoneAccessRow } from "@repo/ui/microphone-access";
import { useBusyPress } from "./busy-press.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

const OPEN_PRIVACY = "Open Privacy & Security in System Settings";

function AllowMicrophone({ microphone }: { microphone: MicrophoneControl }): React.JSX.Element {
  const request = useBusyPress(microphone.onRequest);
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      busy={request.busy}
      busyLabel="Asking for access"
      onClick={request.onPress}
    >
      Allow
    </Button>
  );
}

export function MicrophoneSection({
  view,
  writes,
  microphone,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  microphone: MicrophoneControl;
}): React.JSX.Element {
  const row = microphoneAccessRow(microphone.status);
  return (
    <SettingsSection title="Dictation">
      <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.MICROPHONE)}>
        <SettingsRow
          label={
            <Inline gap={GAP.ICON} wrap={false}>
              Microphone
              {row.granted ? <CheckIcon /> : null}
            </Inline>
          }
          description={row.detail}
        >
          {() => (
            <>
              {row.offerSystemSettings ? (
                <Tooltip label={OPEN_PRIVACY}>
                  <IconButton
                    icon={<ExternalIcon />}
                    label={OPEN_PRIVACY}
                    onClick={microphone.onOpenSettings}
                  />
                </Tooltip>
              ) : null}
              {row.offerAccess ? <AllowMicrophone microphone={microphone} /> : null}
            </>
          )}
        </SettingsRow>
      </div>
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.THIS_MAC}
        section={SETTING_SECTION.MICROPHONE}
        view={view}
      />
    </SettingsSection>
  );
}
