import { CloseIcon, PencilIcon, ResetIcon, TrashIcon } from "@sidecar/panel";
import {
  capturedVoiceHotkey,
  DEFAULT_STOP_HOTKEYS,
  DEFAULT_VOICE_HOTKEYS,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  type SettingsRowsInput,
  VOICE_HOTKEY_CAPTURE,
  VOICE_HOTKEY_NONE,
  voiceHotkeyLabel,
} from "@sidecar/settings";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ActionResult } from "@sidecar/wire";
import { useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { Keycaps } from "../keycaps";
import { VOICE_KEYLESS_NOTE } from "../microphone-access";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import type { ShortcutControl } from "./controls";
import { AttentionMark, ChangedMark } from "./marks";
import { SchemaSettingRows } from "./schema-rows";
import { actionRejection } from "./use-setting-write";
import type { SettingsWrites } from "./writes";

/* What a talk key may be: offered the moment recording starts, and restated
   in the error line for the keystroke that was not one. */
const SHORTCUT_HINT = "Hold ⌃, ⌥ or ⌘ — ⇧ may join — and press a letter or Space.";

/**
 * How Luke is reached rather than what he can see. The chord is drawn as the
 * keys it is — one cap each, the way a keyboard has them — and is a statement
 * rather than a control; the pencil beside it is what moves it. Pressing it
 * starts a recording — what a chord may be is shown under the controls at
 * once, the next whole chord is stored and registered at once, and Escape (or
 * the pencil, now a cross) keeps the key that was already there. Recording
 * happens in that focused button rather than anywhere global, so a keystroke
 * can only become a shortcut while the user is visibly holding the control
 * that asks for one.
 *
 * Reset stands beside the chip only while a chosen chord is stored and no
 * recording is underway: until a chord is stored it could only offer to
 * change nothing, and during a recording the chord it would return to is
 * exactly what typing nothing already keeps. What the row shows is the
 * key as registered, not as stored — the two differ when another app owns the
 * chosen chord, and a row that showed the stored one would name a key that
 * answers nothing.
 *
 * Remove stands beside Reset on Reset's own terms — never while it could only
 * change nothing, which for a removal is while the key is already deleted —
 * and is what deletes the shortcut outright: no chord registered, no default
 * standing in. The row then says "None" rather than "Unavailable", because
 * this absence is the user's own choice, and Reset is the way back.
 */
function ShortcutRow({
  title,
  detail,
  anchor,
  shown,
  chosen,
  off,
  defaultKey,
  attention,
  onChange,
  onCapture,
}: {
  title: string;
  detail: string;
  /** The id a pressed search result lands on. */
  anchor: string;
  /** The accelerator as registered, absent when no candidate answered. */
  shown?: string | undefined;
  /** Whether a chosen chord is stored, which is what Reset has to undo. */
  chosen: boolean;
  /** Whether the shortcut was deleted outright, which is what Remove did. */
  off: boolean;
  /** The first default, which is what the reset offers to return to. */
  defaultKey: string;
  /** Why the key answers nothing right now, absent while it answers. */
  attention?: string;
  onChange: (accelerator: string | undefined) => Promise<ActionResult>;
  onCapture: (capturing: boolean) => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const [recording, setRecording] = useState(false);
  // The change is a round trip through the settings file and the system's
  // registrar, so the controls rest until the store has answered rather than
  // claiming a chord they may not get.
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();

  // Both Luke keys stay registered while a chord is recorded — the recording
  // ends by replacing one — so pressing a current chord mid-recording would
  // open the microphone, or summon the composer, under the very field being
  // typed into. The app is told when a field has the keyboard so it can hold
  // that press, and the unmount arm covers the panel closing over an open
  // recording.
  useEffect(() => {
    onCapture(recording);
    return () => onCapture(false);
  }, [recording, onCapture]);

  const apply = async (accelerator: string | undefined) => {
    setBusy(true);
    setRejection(actionRejection(await onChange(accelerator)));
    setBusy(false);
  };

  return (
    <div className="settings-row" {...searchAnchorProps(anchor)}>
      <span className="settings-copy">
        <strong>
          {title}
          {/* A stored chord is a changed value on the other rows' terms; the
              flag that shows Reset is the flag that earns the mark. */}
          {chosen ? <ChangedMark /> : null}
          {/* The same mark the Voice page wears, because it is the same
              missing key: the chord is still shown and still changeable, the
              mark only says pressing it does nothing yet. */}
          {attention ? <AttentionMark note={attention} /> : null}
        </strong>
        <small>{detail}</small>
      </span>
      <span className="shortcut-controls">
        <span className="settings-actions">
          {/* The chord as its own keys while there is one to press, and a
              sentence when there is not: "Type a shortcut…", "None" and
              "Unavailable" are things being said about the key, not keys to
              draw — and the two absences differ: "None" was asked for, where
              "Unavailable" is another app owning the chord. */}
          {recording ? (
            <span className="shortcut-state" data-recording="true">
              Type a shortcut…
            </span>
          ) : off ? (
            <span className="shortcut-state">None</span>
          ) : shown ? (
            <Keycaps className="shortcut-chord" accelerator={shown} />
          ) : (
            <span className="shortcut-state">Unavailable</span>
          )}
          {chosen && !recording ? (
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={`Reset the shortcut to ${voiceHotkeyLabel(defaultKey)}`}
              title={`Back to ${voiceHotkeyLabel(defaultKey)}`}
              onClick={() => void apply(undefined)}
            >
              <ResetIcon />
            </button>
          ) : null}
          {!off && !recording ? (
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={`Remove the shortcut for ${title}, leaving no key`}
              title="Remove"
              onClick={() => void apply(VOICE_HOTKEY_NONE)}
            >
              <TrashIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={
              recording
                ? "Type the new shortcut, or press Escape to keep this one"
                : `Change the shortcut for ${title}`
            }
            title={recording ? "Cancel" : "Change…"}
            onClick={() => {
              if (recording) {
                setRecording(false);
                return;
              }
              setRejection(undefined);
              setRecording(true);
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // recording no keystroke can reach would read as a dead control.
              tell(ACT_KIND.WINDOW_FOCUS_PANEL);
            }}
            // Focus leaving takes the recording with it: whatever was pressed
            // instead is its own action, not a half-formed chord left armed.
            onBlur={() => setRecording(false)}
            onKeyDown={(event) => {
              // A key that repeats is being held through the chord, not
              // pressed as one; only its first arrival is read.
              if (!recording || event.repeat) return;
              // Nothing typed here is typing: not a Space press on the button,
              // and not the panel's own Escape-to-close behind it.
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") {
                setRecording(false);
                return;
              }
              const read = capturedVoiceHotkey(event);
              if (read.outcome === VOICE_HOTKEY_CAPTURE.PENDING) return;
              if (read.outcome === VOICE_HOTKEY_CAPTURE.REFUSED) {
                setRejection(SHORTCUT_HINT);
                return;
              }
              setRejection(undefined);
              setRecording(false);
              void apply(read.accelerator);
            }}
          >
            {recording ? <CloseIcon /> : <PencilIcon />}
          </button>
        </span>
        {rejection ? (
          <p className="error-message" role="alert">
            {rejection}
          </p>
        ) : recording ? (
          <p className="shortcut-hint">{SHORTCUT_HINT}</p>
        ) : null}
      </span>
    </div>
  );
}

export function ShortcutSection({
  shortcuts,
  view,
  writes,
  voiceAvailable,
}: {
  shortcuts: ShortcutControl;
  view?: SettingsRowsInput;
  writes: SettingsWrites;
  voiceAvailable: boolean;
}): React.JSX.Element {
  // While voice is off the system keys are deliberately not taken — a global
  // chord answering nothing is a key stolen from every other app — so no
  // registered chord ever arrives here. The rows still show the chord each
  // key will hold once voice is on — the stored choice, or the first default
  // — wearing the same mark the Voice page does instead of an "Unavailable"
  // that reads as broken. A key that is genuinely unregistered while voice is
  // on — another app owns the chord — keeps the honest "Unavailable". A key
  // deleted outright shows neither chord nor mark whatever voice does: "None"
  // is already the whole truth about a key that will never register.
  const attention = voiceAvailable ? undefined : VOICE_KEYLESS_NOTE;
  const promisedTalk = view?.settings.voiceHotkey ?? DEFAULT_VOICE_HOTKEYS[0];
  const promisedStop = view?.settings.stopHotkey ?? DEFAULT_STOP_HOTKEYS[0];
  const shownTalk = shortcuts.voiceOff
    ? undefined
    : (shortcuts.voiceHotkey ?? (voiceAvailable ? undefined : promisedTalk));
  const shownStop = shortcuts.stopOff
    ? undefined
    : (shortcuts.stopHotkey ?? (voiceAvailable ? undefined : promisedStop));
  return (
    <section
      className="settings-section settings-plain"
      style={cssCustomProperties({ "--row-index": 1 })}
    >
      <ShortcutRow
        title="Talk to Luke"
        anchor={SETTINGS_SEARCH_ROW.TALK_KEY}
        // What the key actually does, which depends on whether it can report
        // being let go of. Describing a hold to someone whose key reports
        // presses alone would leave them holding it and wondering.
        detail={
          shortcuts.voiceHotkeyHeld
            ? "Hold to talk; the microphone is open only while the key is down."
            : "Press to start talking, again to stop. Luke's key helper could not start, so the key cannot tell when it is let go of."
        }
        {...(shownTalk ? { shown: shownTalk } : undefined)}
        chosen={shortcuts.voiceChosen}
        off={shortcuts.voiceOff}
        defaultKey={DEFAULT_VOICE_HOTKEYS[0] ?? ""}
        {...(attention && !shortcuts.voiceOff ? { attention } : undefined)}
        onChange={shortcuts.onVoiceHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
      {view ? (
        <SchemaSettingRows page={SCHEMA_SETTINGS_PAGE.SHORTCUTS} view={view} writes={writes} />
      ) : null}
      <ShortcutRow
        title="Stop Luke"
        anchor={SETTINGS_SEARCH_ROW.STOP_KEY}
        detail="Press to cut off a reply, from any app."
        {...(shownStop ? { shown: shownStop } : undefined)}
        chosen={shortcuts.stopChosen}
        off={shortcuts.stopOff}
        defaultKey={DEFAULT_STOP_HOTKEYS[0] ?? ""}
        {...(attention && !shortcuts.stopOff ? { attention } : undefined)}
        onChange={shortcuts.onStopHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
    </section>
  );
}
