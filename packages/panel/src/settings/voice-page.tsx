import { VOICE_REMEDY, VOICE_REMEDY_LABEL } from "@luke/features/words";
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
  GAP,
  IconButton,
  Inline,
  SettingsRow,
  SettingsSection,
  Tooltip,
} from "@luke/ui";
import {
  MICROPHONE_UNGRANTED_NOTE,
  microphoneAccessRow,
  OPENAI_KEY_MISSING_NOTE,
  VOICE_KEYLESS_NOTE,
} from "@luke/voice/microphone-access";
import type { MicrophoneControl } from "@luke/voice/settings-controls";
import { useOpenAiKeyMissing, useOpenApiKeys } from "../openai-key.js";
import { useBusyPress } from "./busy-press.js";
import { AttentionMark } from "./marks.js";
import { SchemaSettingRows } from "./schema-rows.js";
import type { SettingsWrites } from "./writes.js";

/** The words of the OpenAI key's row, which points to where the key is kept and never shows it. */
const OPENAI_KEY_WORDS = {
  LABEL: "OpenAI key",
  DETAIL: "Calls and dictation run on your OpenAI key, kept under Codex in Agents.",
  OPEN: "Open in Agents",
} as const;

/**
 * How Luke sounds and what he says unprompted. The OpenAI key a call runs on
 * comes first, then permission, then the controls that need it. Voice needs
 * the signed-in Luke account, and a call or a dictated clip the account's own
 * OpenAI key, which is kept under Codex in Agents, so the page holds no key
 * of its own and its first row points there.
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
  microphoneOffered,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
  microphone: MicrophoneControl;
  /** Whether the platform asks for the microphone itself, which its permission row stands on. */
  microphoneOffered: boolean;
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
              <Inline gap={GAP.ICON} wrap={false}>
                Voice
                <AttentionMark note={VOICE_KEYLESS_NOTE} />
              </Inline>
            }
            description={VOICE_KEYLESS_NOTE}
          >
            {() => null}
          </SettingsRow>
        </SettingsSection>
      )}
      {settings.voiceAvailable ? <OpenAiKeySection /> : null}
      {/* Drawn only once there is a voice for the microphone to reach, on a
          platform whose microphone Luke asks for: until then, the permission
          guards a feature that cannot run, and the page holds the one thing
          to do next rather than a queue of them. */}
      {settings.voiceAvailable && microphoneOffered ? (
        <SettingsSection title="Permissions">
          {/* Access, not use. An agent's Call button is what opens the
              microphone, so the line answers the one question it can: whether
              Luke is allowed. It lives on this page because the microphone's
              one use is the voice a call turns on. */}
          {/* Named and marked like a provider, because it is the same question in
              the same words: what Luke has been let at, and whether it is on. The
              check and the attention mark trade the same spot: allowed, or the
              next thing needing a hand. */}
          {/* Note that the row stands in a wrapper wearing its search anchor,
              because the shared row takes no attribute of a caller's. */}
          <div {...searchAnchorProps(SETTINGS_SEARCH_ROW.MICROPHONE)}>
            <SettingsRow
              label={
                <Inline gap={GAP.ICON} wrap={false}>
                  Microphone
                  {microphoneRow.ready ? (
                    <CheckIcon />
                  ) : (
                    <AttentionMark note={MICROPHONE_UNGRANTED_NOTE} />
                  )}
                </Inline>
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
                  {microphoneRow.offerAccess ? <AllowMicrophone microphone={microphone} /> : null}
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

/**
 * Where the OpenAI key a call runs on is kept: Codex's row in Agents, which
 * the press lands on. A key known to be missing wears the attention mark and
 * the press says to add one; the key itself is never shown here.
 */
function OpenAiKeySection(): React.JSX.Element {
  const missing = useOpenAiKeyMissing();
  const openKey = useOpenApiKeys();
  return (
    <SettingsSection>
      <SettingsRow
        label={
          <Inline gap={GAP.ICON} wrap={false}>
            {OPENAI_KEY_WORDS.LABEL}
            {missing ? <AttentionMark note={OPENAI_KEY_MISSING_NOTE} /> : null}
          </Inline>
        }
        description={OPENAI_KEY_WORDS.DETAIL}
      >
        {() => (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={openKey}>
            {missing ? VOICE_REMEDY_LABEL[VOICE_REMEDY.ADD_OPENAI_KEY] : OPENAI_KEY_WORDS.OPEN}
          </Button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}

/** Allow, which waits on the host's answer to the request, that it has been handed to the voice window. */
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
