import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@luke/settings";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CheckIcon,
  ExternalIcon,
  IconButton,
  SettingsRow,
  SettingsSection,
} from "@luke/ui";
import {
  MICROPHONE_UNGRANTED_NOTE,
  microphoneAccessRow,
  VOICE_KEYLESS_NOTE,
} from "@luke/voice/microphone-access";
import type { MicrophoneControl } from "@luke/voice/settings-controls";
import { Tooltip } from "../tooltip";
import { AttentionMark } from "./marks";
import { SchemaSettingRows } from "./schema-rows";
import type { SettingsWrites } from "./writes";

/**
 * How Luke sounds and what he says unprompted. Permission comes first, then
 * the controls that need it. Voice runs on the signed-in Luke account and on
 * nothing else, so the page offers no credential of its own.
 * The page reveals itself in stages rather than all at once: until voice is
 * available it says how to turn it on, and voice controls appear only once
 * the microphone is ready.
 * Whichever stage is missing wears the same exclamation mark the front
 * page's Voice row wears, so the mark that brought someone here is the mark
 * they land on. The voice Luke speaks with leads the controls — it is what
 * Luke *is* to the ear — offered as one value from a small fixed set: a
 * chip naming it, and under it the app's own menu, which stands above the
 * chip where a window sized to the panel leaves no room below.
 *
 * Each stage is `@luke/ui`'s `SettingsSection` and each line its
 * `SettingsRow`; the microphone's System Settings door is the quiet
 * `IconButton`, and Allow the outline `Button`.
 */
export function VoiceSection({
  view,
  writes,
  microphone,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  microphone: MicrophoneControl;
}): React.JSX.Element {
  const settings = view.settings;
  const microphoneRow = microphoneAccessRow({
    voiceAvailable: microphone.voiceAvailable,
    status: microphone.status,
  });
  return (
    <>
      {/* While voice cannot run, the one section says how to turn it on rather
          than drawing settings for a feature two steps from working. */}
      {settings.voiceAvailable ? null : (
        <SettingsSection>
          <SettingsRow
            label={
              <span className="settings-name">
                Voice
                <AttentionMark note={VOICE_KEYLESS_NOTE} />
              </span>
            }
            description={VOICE_KEYLESS_NOTE}
          >
            {() => null}
          </SettingsRow>
        </SettingsSection>
      )}
      {/* Drawn only once there is a voice for the microphone to reach: until
          then, the permission guards a feature that cannot run, and the page
          holds the one thing to do next rather than a queue of them. */}
      {settings.voiceAvailable ? (
        <SettingsSection title="Permissions">
          {/* Access, not use. The talk key is what opens the microphone, so a
              button here could only ever repeat what the key already does — the
              line answers the one question it can: whether Luke is allowed. It
              lives on this page, under the key it waits on, because the
              microphone's one use is the voice that key turns on. */}
          {/* Named and marked like a provider, because it is the same question in
              the same words: what Luke has been let at, and whether it is on. The
              check and the attention mark trade the same spot: allowed, or the
              next thing needing a hand. */}
          {/* Note that the row stands in a wrapper wearing its search anchor,
              because the shared row takes no attribute of a caller's. */}
          <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.MICROPHONE)}>
            <SettingsRow
              label={
                <span className="settings-name">
                  Microphone
                  {microphoneRow.ready ? (
                    <CheckIcon />
                  ) : (
                    <AttentionMark note={MICROPHONE_UNGRANTED_NOTE} />
                  )}
                </span>
              }
              description={microphoneRow.detail}
            >
              {() => (
                <>
                  {microphoneRow.offerSystemSettings ? (
                    <Tooltip label="System Settings">
                      <IconButton
                        icon={<ExternalIcon />}
                        label="Open Privacy & Security in System Settings"
                        onClick={microphone.onOpenSettings}
                      />
                    </Tooltip>
                  ) : null}
                  {microphoneRow.offerAccess ? (
                    <Button variant={BUTTON_VARIANT.OUTLINE} onClick={microphone.onRequest}>
                      Allow
                    </Button>
                  ) : null}
                </>
              )}
            </SettingsRow>
          </div>
        </SettingsSection>
      ) : null}
      {/* `ready` already folds the account in — a microphone with no voice to
          reach never reports itself ready — so the controls stand exactly
          while both halves do. */}
      {microphoneRow.ready ? <VoiceControlsSection view={view} writes={writes} /> : null}
    </>
  );
}

/** The voice controls themselves, below the permission that lets Luke listen. */
function VoiceControlsSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <SettingsSection title="Conversation">
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.VOICE}
        section={SETTING_SECTION.CONTROLS}
        view={view}
        writes={writes}
      />
    </SettingsSection>
  );
}
