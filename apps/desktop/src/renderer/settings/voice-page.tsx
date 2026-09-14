import { CheckIcon, ExternalIcon, KeyIcon, ShieldIcon } from "@sidecar/panel";
import {
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@sidecar/settings";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import {
  MICROPHONE_UNGRANTED_NOTE,
  microphoneAccessRow,
  VOICE_KEYLESS_NOTE,
} from "../microphone-access";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import type { ConnectionInput } from "./connection-schema";
import type { MicrophoneControl } from "./controls";
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
 * Luke *is* to the ear — offered the way macOS offers one value from a small
 * fixed set: a pop-up button whose closed face is drawn here and whose open
 * menu is the system's, which also lets it escape a window sized to the
 * panel rather than being clipped by it.
 */
export function VoiceSection({
  input,
  view,
  writes,
  microphone,
}: {
  input: ConnectionInput;
  view: SettingsRowsInput;
  writes: SettingsWrites;
  microphone: MicrophoneControl;
}): React.JSX.Element {
  const settings = input.settings;
  const microphoneRow = microphoneAccessRow({
    voiceAvailable: microphone.voiceAvailable,
    status: microphone.status,
  });
  return (
    <>
      {/* While voice cannot run, the one section says how to turn it on rather
          than drawing settings for a feature two steps from working. */}
      {settings.voiceAvailable ? null : (
        <section className="settings-section" style={cssCustomProperties({ "--row-index": 1 })}>
          <h2>
            <KeyIcon />
            Voice
            <AttentionMark note={VOICE_KEYLESS_NOTE} />
          </h2>
          <p className="settings-note">{VOICE_KEYLESS_NOTE}</p>
        </section>
      )}
      {/* Drawn only once there is a voice for the microphone to reach: until
          then, the permission guards a feature that cannot run, and the page
          holds the one thing to do next rather than a queue of them. */}
      {settings.voiceAvailable ? (
        <section className="settings-section" style={cssCustomProperties({ "--row-index": 1 })}>
          <h2>
            <ShieldIcon />
            Permissions
          </h2>
          {/* Access, not use. The talk key is what opens the microphone, so a
              button here could only ever repeat what the key already does — the
              line answers the one question it can: whether Luke is allowed. It
              lives on this page, under the key it waits on, because the
              microphone's one use is the voice that key turns on. */}
          {/* Named and marked like a provider, because it is the same question in
              the same words: what Luke has been let at, and whether it is on. The
              check and the attention mark trade the same spot: allowed, or the
              next thing needing a hand. */}
          <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.MICROPHONE)}>
            <span className="settings-copy">
              <span className="settings-name">
                <strong>Microphone</strong>
                {microphoneRow.ready ? (
                  <CheckIcon />
                ) : (
                  <AttentionMark note={MICROPHONE_UNGRANTED_NOTE} />
                )}
              </span>
              {microphoneRow.detail ? <small>{microphoneRow.detail}</small> : undefined}
            </span>
            <span className="settings-actions">
              {microphoneRow.offerSystemSettings ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Open Privacy & Security in System Settings"
                  /* The ellipsis is the promise that it opens somewhere else. */
                  title="System Settings…"
                  onClick={microphone.onOpenSettings}
                >
                  <ExternalIcon />
                </button>
              ) : null}
              {microphoneRow.offerAccess ? (
                <button type="button" className="quiet-button" onClick={microphone.onRequest}>
                  Allow
                </button>
              ) : null}
            </span>
          </div>
        </section>
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
    <section
      className="settings-section settings-plain"
      style={cssCustomProperties({ "--row-index": 2 })}
    >
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.VOICE}
        section={SETTING_SECTION.CONTROLS}
        view={view}
        writes={writes}
      />
    </section>
  );
}
