import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@luke/settings";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import type { MicrophoneControl } from "@luke/settings/settings-controls";
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
} from "@luke/ui";
import { microphoneAccessRow } from "@luke/ui/microphone-access";
import { useBusyPress } from "./busy-press.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/** What the System Settings door is called, for a reader and its hover. */
const OPEN_PRIVACY = "Open Privacy & Security in System Settings";

/** Allow, which waits on the system's answer to the request. */
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

/**
 * microphone-section.tsx -- the This Mac page's Dictation group: whether Luke may open the microphone, and which one it prefers.
 *
 * Dictation records the microphone in the window it is pressed in, so the
 * group stands only on a platform whose microphone Luke asks for itself.
 * Its first row answers access, not use: whether macOS lets Luke at the
 * microphone, a check once it does, Allow while macOS has not been asked,
 * and the door to System Settings once it has answered, the one place its
 * answer can be changed. Under it stand the microphone's own settings, the
 * schema's rows of This Mac's microphone section (`SchemaSettingRows`).
 *
 * Each line is `@luke/ui`'s `SettingsRow`; the System Settings door is the
 * quiet `IconButton`, and Allow the outline `Button`.
 */
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
      {/* Note that the row stands in a wrapper wearing its search anchor,
          because the shared row takes no attribute of a caller's. */}
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
        writes={writes}
      />
    </SettingsSection>
  );
}
