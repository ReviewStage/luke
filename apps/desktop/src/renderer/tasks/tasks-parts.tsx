import {
  CloseIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from "@luke/ui";
import type { CallStatus } from "@luke/ui/tasks-model";
import { APP_COMMAND } from "#shared/shortcuts";
import { ThinkingDots } from "../thinking-dots";
import { Tooltip } from "../tooltip";

/**
 * planning-parts.tsx -- the open plan's call bar, as a pure layout.
 *
 * It draws what it is handed and decides nothing, so what it shows is
 * `planning-model.ts`'s answer and a press is a callback the tab hands down.
 * Luke's face and the meter for whoever is talking are the sidebar's, and
 * the captions the window's own, drawn for a planning call exactly as for
 * any other.
 */

/** What a reader is told while the backend works; the sighted read the dots and the line. */
const TASK_WORKING_LABEL = "Luke is working on it";

/** The backend line's names for its two parts, and what Luke says with no command pending. */
const BRAIN_NAME = "Luke";
const BRAIN_THINKING = "Thinking";
const NOTETAKER_WRITING = "Notetaker · Writing notes";

/** Each call control's name for a reader and its hover, by whether it is on. */
export const CALL_CONTROL_LABEL = {
  MUTE_MICROPHONE: "Mute microphone",
  UNMUTE_MICROPHONE: "Unmute microphone",
  MUTE_SPEAKER: "Mute speaker",
  UNMUTE_SPEAKER: "Unmute speaker",
  END_CALL: "End call",
} as const;

/**
 * The call's two lines: the voice's word, and the backend's while it works.
 * A narrow bar drops the notetaker's part while Luke's stands, so Luke's
 * keeps the room (desktop.css). Where `titled`, Luke's command carries its
 * whole words as the system's own hint, for the floating window, which is
 * too small to hold a tooltip.
 */
function CallStatusLines({
  status,
  muted,
  titled,
}: {
  status: CallStatus | undefined;
  muted: boolean;
  titled: boolean;
}): React.JSX.Element {
  const brain = status?.backend.brain;
  const notes = status?.backend.notes ?? false;
  return (
    <span className="call-status">
      <span className="call-status-word" data-muted={String(muted)}>
        {status?.voiceWord}
      </span>
      {brain !== undefined || notes ? (
        <span className="call-backend">
          <ThinkingDots />
          {brain === undefined ? null : (
            <span
              className="call-backend-part"
              data-part="planner"
              title={titled ? brain.action : undefined}
            >
              {BRAIN_NAME} ·{" "}
              {brain.action === undefined ? (
                BRAIN_THINKING
              ) : (
                <span className="call-backend-action">{brain.action}</span>
              )}
            </span>
          )}
          {notes ? (
            <span className="call-backend-part" data-part="notes">
              {NOTETAKER_WRITING}
            </span>
          ) : null}
          <span className="visually-hidden" role="status">
            {TASK_WORKING_LABEL}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** A mute the call bar offers: its glyph struck through, and filled, while it is on. */
function CallToggle({
  on,
  label,
  command,
  icon,
  onPress,
}: {
  on: boolean;
  label: string;
  command: typeof APP_COMMAND.TOGGLE_MICROPHONE | typeof APP_COMMAND.TOGGLE_SPEAKER;
  icon: React.JSX.Element;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={label} command={command}>
      <button
        type="button"
        className="icon-button call-toggle"
        aria-label={label}
        aria-pressed={on}
        onClick={onPress}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/**
 * The call bar under the document, laid out the way a voice composer's own
 * controls are. At rest it is one press, the microphone's: Talk about this
 * plan, or what the microphone needs first. Once the open plan's call is in
 * progress it is the call: its status at the left, and at the right the
 * speaker and microphone mutes, each struck through and filled while on, and
 * End call beside them, apart from both so muting never hangs up. The
 * microphone's press is the same toggle at rest and in the call, so the talk
 * key, the permission asks, and a call about another plan all answer as they
 * always have. The speaker silences Luke on this Mac alone; the call goes on.
 * A call the tab reports a status for is drawn as the call even where it
 * offers no stop, a fixture's staged call or one closing, since the press
 * on each control is the one it always was. The two mutes' chords are not
 * the bar's to offer: they answer while any call is in progress, wherever the
 * panel stands (`useCallCommands`). A narrow bar stacks its status over its
 * controls rather than cutting the voice's word (desktop.css).
 */
export function CallBar({
  status,
  microphone,
  speaker,
  stop,
  titled = false,
}: {
  /** The call's status, absent while no call about this plan stands. */
  status: CallStatus | undefined;
  microphone: { label: string; enabled: boolean; muted: boolean; onPress: () => void };
  speaker: { muted: boolean; onPress: () => void };
  /** Ends the call; shown is whether the open plan's call is in progress. */
  stop: { shown: boolean; onPress: () => void };
  /** Whether Luke's command carries its whole words as the system's hint, where no tooltip fits. */
  titled?: boolean;
}): React.JSX.Element {
  const inProgress = stop.shown;
  if (!inProgress && status === undefined) {
    return (
      <footer className="call-bar" data-call="false">
        <button
          type="button"
          className={microphone.enabled ? "primary-button call-start" : "toolbar-button call-start"}
          disabled={!microphone.enabled}
          onClick={microphone.onPress}
        >
          <MicrophoneIcon />
          {microphone.label}
        </button>
      </footer>
    );
  }
  return (
    <footer className="call-bar" data-call="true">
      <CallStatusLines status={status} muted={microphone.muted} titled={titled} />
      <div className="call-controls">
        <CallToggle
          on={speaker.muted}
          label={
            speaker.muted ? CALL_CONTROL_LABEL.UNMUTE_SPEAKER : CALL_CONTROL_LABEL.MUTE_SPEAKER
          }
          command={APP_COMMAND.TOGGLE_SPEAKER}
          icon={speaker.muted ? <SpeakerOffIcon /> : <SpeakerIcon />}
          onPress={speaker.onPress}
        />
        <CallToggle
          on={microphone.muted}
          label={
            microphone.muted
              ? CALL_CONTROL_LABEL.UNMUTE_MICROPHONE
              : CALL_CONTROL_LABEL.MUTE_MICROPHONE
          }
          command={APP_COMMAND.TOGGLE_MICROPHONE}
          icon={microphone.muted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
          onPress={microphone.onPress}
        />
        <Tooltip label={CALL_CONTROL_LABEL.END_CALL}>
          <button
            type="button"
            className="call-end"
            aria-label={CALL_CONTROL_LABEL.END_CALL}
            onClick={stop.onPress}
          >
            <CloseIcon />
          </button>
        </Tooltip>
      </div>
    </footer>
  );
}
