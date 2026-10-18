/**
 * voice-keys.tsx -- the Voice page's Keys group: Luke's two system-wide keys, talk and stop, each a chord that can be changed.
 */

import { AttentionMark, ChangedMark } from "@luke/panel/settings/marks";
import { Shortcut } from "@luke/panel/shortcut";
import {
  capturedVoiceHotkey,
  DEFAULT_STOP_HOTKEYS,
  DEFAULT_VOICE_HOTKEYS,
  type SettingsRowsInput,
  VOICE_HOTKEY_CAPTURE,
  VOICE_HOTKEY_NONE,
} from "@luke/settings";
import { SETTINGS_SEARCH_ROW } from "@luke/settings/settings-anchors";
import {
  APP_SHORTCUTS,
  commandForKey,
  KEYED_COMMANDS,
  type KeyedCommand,
  shortcutAccelerator,
  shortcutLabel,
} from "@luke/settings/shortcuts";
import {
  PencilIcon,
  ResetIcon,
  type SettingsRowControl,
  SettingsSection,
  TrashIcon,
} from "@luke/ui";
import { actionRejection } from "@luke/ui/use-setting-write";
import { VOICE_KEYLESS_NOTE } from "@luke/voice/microphone-access";
import type { ShortcutControl } from "@luke/voice/settings-controls";
import type { ActionResult } from "@luke/wire";
import { useEffect, useId, useRef, useState } from "react";
import { MenuRow } from "./menu-row";

/* What a talk key may be: offered the moment recording starts, and restated
   in the error line for the keystroke that was not one. */
const SHORTCUT_HINT = "Hold ⌃, ⌥, or ⌘, optionally with ⇧, and press a letter or Space.";

/** Why a chord the window already answers cannot become a Luke key. */
function windowChordRefusal(command: KeyedCommand): string {
  const { label, chord } = APP_SHORTCUTS[command];
  return `${shortcutLabel(shortcutAccelerator(chord))} is Luke's own shortcut for ${label}. Choose another.`;
}

/**
 * How Luke is reached rather than what he can see. The chord is drawn as
 * every chord in the window is, in the same column every other row's chord
 * stands in, inside a field of its own, because unlike the rows under it this
 * key can be changed: pressing the field, or Change shortcut in the row's ⋯,
 * starts a recording. The field rings and says "Press a shortcut…", what a chord may be is said under the row's
 * own description at once, the next whole chord is stored and registered at
 * once, and Escape (or pressing the field again) keeps the key that was
 * already there. A chord refused is explained in that same place, inline,
 * rather than in a toast. Recording happens in that focused field rather
 * than anywhere global, so a keystroke can only become a shortcut while the
 * user is visibly holding the control that asks for one.
 *
 * The row's other acts are its ⋯'s, as every Settings row's are. Reset is
 * offered only while a chosen chord is stored and no recording is underway:
 * until a chord is stored it could only offer to change nothing, and during a
 * recording the chord it would return to is exactly what typing nothing
 * already keeps. What the row shows is the key as registered, not as stored —
 * the two differ when another app owns the chosen chord, and a row that
 * showed the stored one would name a key that answers nothing.
 *
 * The row is `@luke/ui`'s `SettingsRow`, through `MenuRow`: the hint stands
 * under the key's own detail while a recording listens, and a refusal in the
 * row's error line, which a reader hears as it arrives.
 *
 * Remove is offered on Reset's own terms — never while it could only change
 * nothing, which for a removal is while the key is already deleted — and is
 * what deletes the shortcut outright: no chord registered, no default
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
  /** What the key does where its title alone would not say it. */
  detail?: string | undefined;
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
  const [recording, setRecording] = useState(false);
  // The change is a round trip through the settings file and the system's
  // registrar, so the controls rest until the store has answered rather than
  // claiming a chord they may not get.
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const field = useRef<HTMLButtonElement | null>(null);
  const chordId = useId();
  // What the field holds, in words: its label names the act, so the key it
  // stands at is what describes it to someone who cannot see the field.
  const chordWords = off ? "None" : shown ? shortcutLabel(shown) : "Unavailable";

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
  const record = () => {
    setRejection(undefined);
    setRecording(true);
  };

  const actions = [
    {
      label: "Change shortcut",
      icon: <PencilIcon />,
      disabled: busy,
      // Note that the field takes the focus the closing menu handed its ⋯,
      // because the recording listens in the field and ends when it blurs.
      onSelect: () => {
        record();
        field.current?.focus();
      },
    },
    ...(chosen && !recording
      ? [
          {
            label: `Reset to ${shortcutLabel(defaultKey)}`,
            icon: <ResetIcon />,
            disabled: busy,
            onSelect: () => void apply(undefined),
          },
        ]
      : []),
    ...(!off && !recording
      ? [
          {
            label: "Remove shortcut",
            icon: <TrashIcon />,
            disabled: busy,
            onSelect: () => void apply(VOICE_HOTKEY_NONE),
          },
        ]
      : []),
  ];

  // Note that the field is described by the row's words and its refusal as
  // well as by its chord, because a refusal still standing must be heard
  // again when the field is returned to, not only as it arrived.
  const chordField = (control: SettingsRowControl) => (
    <button
      ref={field}
      type="button"
      className="shortcut-field"
      disabled={busy}
      aria-pressed={recording}
      aria-describedby={
        [recording ? undefined : chordId, control["aria-describedby"]]
          .filter((part) => part !== undefined)
          .join(" ") || undefined
      }
      aria-invalid={control["aria-invalid"]}
      aria-label={
        recording
          ? `Cancel, or type the new shortcut for ${title}`
          : `Change the shortcut for ${title}`
      }
      onClick={() => {
        if (recording) {
          setRecording(false);
          return;
        }
        record();
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
        // A system-wide key wins over the window's own chord, so a
        // key that would take one of them is refused rather than
        // left to silence it.
        const taken = commandForKey(KEYED_COMMANDS, event.nativeEvent);
        if (taken !== undefined) {
          setRejection(windowChordRefusal(taken));
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
      {/* The chord while there is one to press, and a sentence when
            there is not: "Press a shortcut…", "None" and
            "Unavailable" are things being said about the key, not keys to
            draw — and the two absences differ: "None" was asked for, where
            "Unavailable" is another app owning the chord. */}
      <span id={chordId} className="visually-hidden">
        {chordWords}
      </span>
      {recording ? (
        <span className="shortcut-state">Press a shortcut…</span>
      ) : off ? (
        <span className="shortcut-state">None</span>
      ) : shown ? (
        <Shortcut accelerator={shown} />
      ) : (
        <span className="shortcut-state">Unavailable</span>
      )}
    </button>
  );

  return (
    <MenuRow
      label={`${title} shortcut actions`}
      actions={actions}
      anchor={anchor}
      row={{
        label: title,
        adornment:
          chosen || attention ? (
            <>
              {/* A stored chord is a changed value on the other rows' terms; the
                  flag that shows Reset is the flag that earns the mark. */}
              {chosen ? <ChangedMark /> : null}
              {/* The same mark the Voice page wears, because it is the same
                  missing key: the chord is still shown and still changeable, the
                  mark only says pressing it does nothing yet. */}
              {attention ? <AttentionMark note={attention} /> : null}
            </>
          ) : null,
        // What a chord may be stands under the key's own detail while a
        // recording listens, and a refusal takes the row's error line.
        description:
          recording && !rejection ? (
            <>
              {detail === undefined ? null : (
                <>
                  {detail}
                  <br />
                </>
              )}
              {SHORTCUT_HINT}
            </>
          ) : (
            detail
          ),
        error: rejection,
        describedControl: chordField,
      }}
    />
  );
}

/**
 * The two keys under the voice they reach, drawn whether or not voice can run
 * yet, so a key can be chosen before the first call.
 */
export function ShortcutSection({
  shortcuts,
  view,
  voiceAvailable,
}: {
  shortcuts: ShortcutControl;
  view?: SettingsRowsInput;
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
    <SettingsSection title="Keys">
      <ShortcutRow
        title="Talk to Luke"
        anchor={SETTINGS_SEARCH_ROW.TALK_KEY}
        // What the key actually does, which depends on whether it can report
        // being let go of. Describing a hold to someone whose key reports
        // presses alone would leave them holding it and wondering.
        detail={
          shortcuts.voiceHotkeyHeld
            ? "Hold to talk from any app."
            : "Press to start talking, again to stop. Luke's key helper could not start."
        }
        {...(shownTalk ? { shown: shownTalk } : undefined)}
        chosen={shortcuts.voiceChosen}
        off={shortcuts.voiceOff}
        defaultKey={DEFAULT_VOICE_HOTKEYS[0] ?? ""}
        {...(attention && !shortcuts.voiceOff ? { attention } : undefined)}
        onChange={shortcuts.onVoiceHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
      <ShortcutRow
        title="Stop Luke"
        anchor={SETTINGS_SEARCH_ROW.STOP_KEY}
        {...(shownStop ? { shown: shownStop } : undefined)}
        chosen={shortcuts.stopChosen}
        off={shortcuts.stopOff}
        defaultKey={DEFAULT_STOP_HOTKEYS[0] ?? ""}
        {...(attention && !shortcuts.stopOff ? { attention } : undefined)}
        onChange={shortcuts.onStopHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
    </SettingsSection>
  );
}
