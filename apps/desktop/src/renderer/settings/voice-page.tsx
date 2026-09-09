import {
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
  VOICE_CREDENTIAL_PROVIDER,
} from "@sidecar/credentials/vocabulary";
import { CheckIcon, ExternalIcon, KeyIcon, LukeIcon, ShieldIcon } from "@sidecar/panel";
import {
  APP_SETTING_SCHEMA,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@sidecar/settings";
import { VOICE_SOURCE, type VoiceSource } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ActionResult } from "@sidecar/wire";
import { APP_SETTING_ID } from "../luke-guide";
import {
  MICROPHONE_UNGRANTED_NOTE,
  microphoneAccessRow,
  VOICE_KEYLESS_NOTE,
  VOICE_SOURCE_DETAIL,
  VOICE_SOURCE_LABEL,
  voiceSourceLabel,
} from "../microphone-access";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-search";
import { SETTINGS_VIEW } from "../settings-views";
import { ConnectionRow } from "./connection-row";
import { CONNECTION_SECTION, type ConnectionInput, connectionsFor } from "./connection-schema";
import type { MicrophoneControl } from "./controls";
import { AttentionMark } from "./marks";
import { STORAGE_UNAVAILABLE_NOTE } from "./notes";
import { SchemaSettingRows } from "./schema-rows";
import { useSettingWrite } from "./use-setting-write";
import type { SettingsWrites } from "./writes";

/**
 * How Luke sounds and what he says unprompted. Permission comes first, then
 * the account or key voice uses, then the controls that need both.
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
      {input.visibility.accountDrawn ? (
        <ProviderSection rowIndex={2} input={input} writes={writes} />
      ) : null}
      {/* `ready` already folds the key in — a microphone with no voice to
          reach never reports itself ready — so the controls stand exactly
          while both halves do. */}
      {microphoneRow.ready ? <VoiceControlsSection view={view} writes={writes} /> : null}
    </>
  );
}

/** The voice controls themselves, below the permission that lets Luke listen. */
export function VoiceControlsSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <section
      className="settings-section settings-plain"
      style={cssCustomProperties({ "--row-index": 3 })}
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

/**
 * The choice itself: two halves side by side, each carrying its own name, with
 * the live one marked. A radio group rather than two buttons, because it is
 * one value from a small fixed set — the same thing a
 * pop-up would be, drawn open because there are only two and the whole point
 * is seeing them together.
 *
 * Pressing the half that is already live does nothing. Pressing the other
 * either switches to a key already stored, or — with none — begins the entry
 * that would store one, which is the same action the row's Connect was: a source
 * you have not supplied yet has to be supplied before it can be chosen.
 */
export function VoiceSourceToggle({
  source,
  keyStored,
  storageLocked,
  onChoose,
  onConnect,
}: {
  /** Which source is actually running, as the store resolved it. */
  source: VoiceSource;
  /** Whether a key is stored at all, which decides what its half does. */
  keyStored: boolean;
  /** Whether this system can hold a key, which decides whether it can at all. */
  storageLocked: boolean;
  onChoose: (source: VoiceSource) => Promise<ActionResult>;
  /** Begins the entry, which stands the panel down to the slot. */
  onConnect: () => void;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChoose);
  return (
    <>
      {/* Real radios under the drawing, the way the calendar's choices are
          real checkboxes: one value from a set of two is exactly what a radio
          group is, and taking the native one means the arrow keys, the
          grouping, and the announcement all come with it. */}
      <div className="source-toggle" {...searchAnchorProps(APP_SETTING_ID.VOICE_SOURCE)}>
        {[VOICE_SOURCE.ACCOUNT, VOICE_SOURCE.KEY].map((candidate) => {
          const live = candidate === source;
          // The key's half is the one that can be unavailable: a machine with
          // no encrypted storage has nowhere to put one, so it can neither be
          // supplied nor chosen. The account's half is always there — this
          // section is only drawn for a signed-in account.
          const blocked = candidate === VOICE_SOURCE.KEY && storageLocked;
          // A key not yet supplied cannot be chosen, so its half says what
          // pressing it will actually do.
          const asksForKey = candidate === VOICE_SOURCE.KEY && !keyStored;
          return (
            <label
              key={candidate}
              /* The Feedback section's own button, wearing its class rather
                 than a copy of its measurements: the two sections offer the
                 same kind of pair a few rows apart, and one that drifted from
                 the other would be the drift nobody notices. */
              className="quiet-button source-choice"
              data-live={String(live)}
              title={blocked ? STORAGE_UNAVAILABLE_NOTE : undefined}
            >
              <input
                type="radio"
                className="visually-hidden"
                name="voice-source"
                value={candidate}
                checked={live}
                disabled={busy || blocked}
                aria-label={voiceSourceLabel(candidate)}
                onChange={() => {
                  // With no key stored there is nothing to switch to yet, so
                  // the press asks for one instead of storing a choice that
                  // would resolve straight back to where it started.
                  if (asksForKey) onConnect();
                  else run(candidate);
                }}
              />
              <span className="source-name">
                {VOICE_SOURCE_LABEL[candidate]}
                {live ? <CheckIcon /> : null}
              </span>
              <small>
                {asksForKey ? "Connect a key to use it" : VOICE_SOURCE_DETAIL[candidate]}
              </small>
            </label>
          );
        })}
      </div>
      {rejection ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
    </>
  );
}

/**
 * The one question this section settles: which credential Luke speaks and
 * reviews sessions on. Both answers stand here, side by side and switchable,
 * because a choice split across two places — an account here, a key row
 * there — is a choice nobody knows they have.
 *
 * The account itself is not here. Signing out and deleting are rare acts that
 * cannot be taken back, and they sit at the foot of the Settings front page;
 * this section is only ever read and switched.
 */
export function ProviderSection({
  input,
  writes,
  rowIndex,
}: {
  input: ConnectionInput;
  /** Where the section stands in the page's arrival stagger, counted by the caller. */
  rowIndex: number;
  writes: SettingsWrites;
}): React.JSX.Element {
  const settings = input.settings;
  const credentials = input.credentials;
  // Whether this system cannot store a key at all. The key half cannot be
  // chosen or supplied then, and it says why rather than going quiet.
  const storageLocked = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  const keyStored =
    settings.credentialSources[VOICE_CREDENTIAL_PROVIDER.id] !== CREDENTIAL_SOURCE.NONE;
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": rowIndex })}>
      <h2>
        <LukeIcon />
        Provider
        {/* The mark for voice having nothing to run on sits where both ways
            in are drawn: the two halves of the toggle below. */}
        {settings.voiceAvailable ? null : <AttentionMark note={VOICE_KEYLESS_NOTE} />}
      </h2>
      <VoiceSourceToggle
        source={settings.voiceSource}
        keyStored={keyStored}
        storageLocked={storageLocked}
        onChoose={(source) => writes.setting(APP_SETTING_SCHEMA.voiceSource.field, source)}
        onConnect={() => credentials.connect(VOICE_CREDENTIAL_PROVIDER.id)}
      />
      {/* A key is a connection, so its half draws the credential row — from the
          same table every other connection is drawn from, which is also what
          decides that the row stands while the key half is live or while a key
          is being entered into it. */}
      {connectionsFor(SETTINGS_VIEW.VOICE, CONNECTION_SECTION.VOICE_PROVIDER).map((spec) => (
        <ConnectionRow key={spec.id} spec={spec} input={input} />
      ))}
      {storageLocked ? <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p> : null}
    </section>
  );
}
