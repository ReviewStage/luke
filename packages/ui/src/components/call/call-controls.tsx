/**
 * call-controls.tsx -- a call's controls: its two mutes, Video on or off, the one red End call, the bar that lays them out beside the call's status, and the status a message box's foot shows while a call stands.
 *
 * Every place a call is steered from draws these, so a mute, the video's
 * toggle, and the way to hang up wear the same words, glyphs, and colours
 * wherever they stand. Each takes what it shows and the press it hands back,
 * and decides nothing: whether a call stands, what its status says, and
 * what a press asks of the voice are the owner's. End call is the one red
 * control, on the danger fill with the hang-up glyph (`GLYPH.END_CALL`),
 * because ending a call cannot be undone; a mute is quiet while off and lit
 * in neutral grey while on, its glyph struck through, since muting is no
 * failure. A live call wears the working blue.
 */

import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  MicrophoneIcon,
  MicrophoneOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  VideoIcon,
  VideoOffIcon,
} from "../../face/glyphs.js";
import { GLYPH } from "../../icons/glyph-registry.js";
import { STATUS_TONE } from "../../status-tone.js";
import {
  type CallStatus,
  MUTE_MICROPHONE_LABEL,
  UNMUTE_MICROPHONE_LABEL,
} from "../../tasks-model.js";
import { BUTTON_SHAPE, BUTTON_VARIANT, type ButtonShape, IconButton } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { ThinkingDots } from "../thinking-dots/thinking-dots.js";
import { TIME_LOOK, Time } from "../time/time.js";
import { Tooltip } from "../tooltip/hint.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/** What a reader is told while the backend works; the sighted read the dots and the line. */
const TASK_WORKING_LABEL = "Luke is working on it";

/** The backend line's words, subject-free like the voice's: what Luke says with no command pending, and what leads the command he runs. */
const BRAIN_THINKING = "Thinking";
const BRAIN_WORKING = "Working";

/** Each call control's name for a reader and its hover, by whether it is on. */
export const CALL_CONTROL_LABEL = {
  MUTE_MICROPHONE: MUTE_MICROPHONE_LABEL,
  UNMUTE_MICROPHONE: UNMUTE_MICROPHONE_LABEL,
  MUTE_SPEAKER: "Mute speaker",
  UNMUTE_SPEAKER: "Unmute speaker",
  VIDEO_OFF: "Turn video off",
  VIDEO_ON: "Turn video on",
  END_CALL: "End call",
} as const;

/** Where a call stands, as its status in a message box's foot says it: coming up, up, or on its way down. */
export const CALL_STAGE = {
  CONNECTING: "connecting",
  LIVE: "live",
  ENDING: "ending",
} as const;

export type CallStage = (typeof CALL_STAGE)[keyof typeof CALL_STAGE];

/** What a call's status in a message box's foot says: coming up, live, muted, or on its way down. */
export const CALL_LIVE_WORD = {
  CONNECTING: "Connecting…",
  LIVE: "On call",
  MUTED: "Muted",
  ENDING: "Ending…",
} as const;

/** What a mute silences: the developer's microphone, or Luke's voice on this Mac alone. */
export const CALL_DEVICE = {
  MICROPHONE: "microphone",
  SPEAKER: "speaker",
} as const;

export type CallDevice = (typeof CALL_DEVICE)[keyof typeof CALL_DEVICE];

/** Each device's mute: its names off and on, the chord that toggles it, and its glyphs off and on. */
const MUTE = {
  [CALL_DEVICE.MICROPHONE]: {
    mute: CALL_CONTROL_LABEL.MUTE_MICROPHONE,
    unmute: CALL_CONTROL_LABEL.UNMUTE_MICROPHONE,
    command: APP_COMMAND.TOGGLE_MICROPHONE,
    Live: MicrophoneIcon,
    Muted: MicrophoneOffIcon,
  },
  [CALL_DEVICE.SPEAKER]: {
    mute: CALL_CONTROL_LABEL.MUTE_SPEAKER,
    unmute: CALL_CONTROL_LABEL.UNMUTE_SPEAKER,
    command: APP_COMMAND.TOGGLE_SPEAKER,
    Live: SpeakerIcon,
    Muted: SpeakerOffIcon,
  },
} as const;

/**
 * A mute the call offers, round in the call bar and square in an agent's
 * composer row: named for what the press will do, with its chord in its
 * hint, and its glyph struck through, lit in neutral grey, while muted.
 */
export function CallMute({
  device,
  muted,
  shape = BUTTON_SHAPE.ROUND,
  onPress,
}: {
  device: CallDevice;
  muted: boolean;
  shape?: ButtonShape | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const mute = MUTE[device];
  const label = muted ? mute.unmute : mute.mute;
  return (
    <Tooltip label={label} command={mute.command}>
      <IconButton
        variant={BUTTON_VARIANT.QUIET}
        shape={shape}
        icon={muted ? <mute.Muted /> : <mute.Live />}
        label={label}
        pressed={muted}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/** End call: the one red control, round, wearing the hang-up glyph, wherever a call is steered from. */
export function EndCallButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <Tooltip label={CALL_CONTROL_LABEL.END_CALL}>
      <IconButton
        variant={BUTTON_VARIANT.DANGER}
        shape={BUTTON_SHAPE.ROUND}
        icon={<GLYPH.END_CALL />}
        label={CALL_CONTROL_LABEL.END_CALL}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/** What a call's status is drawn from: a call coming up or going down, which has no count yet or any more, or one that is up. */
export type CallLiveProps =
  | { stage: typeof CALL_STAGE.CONNECTING | typeof CALL_STAGE.ENDING }
  | {
      stage: typeof CALL_STAGE.LIVE;
      /** Epoch milliseconds the call started, which its count runs from. */
      startedAt: number;
      /** Whether the call's microphone is muted. */
      muted: boolean;
      now?: number | undefined;
    };

/** The mark a call's status leads with: the live tone while up, the struck microphone while muted, and the quiet tone either side of it. */
function CallLiveMark({ props }: { props: CallLiveProps }): React.JSX.Element {
  if (props.stage === CALL_STAGE.LIVE && props.muted) {
    return (
      <span className="luke-call-live-muted" aria-hidden="true">
        <MicrophoneOffIcon />
      </span>
    );
  }
  const tone = props.stage === CALL_STAGE.LIVE ? STATUS_TONE.WORKING : STATUS_TONE.NEUTRAL;
  return <span className="luke-call-live-mark" data-tone={tone} aria-hidden="true" />;
}

/** The word a call's status says, by its stage and, while it is up, whether it is muted. */
function callLiveWord(props: CallLiveProps): string {
  if (props.stage !== CALL_STAGE.LIVE) {
    return props.stage === CALL_STAGE.CONNECTING
      ? CALL_LIVE_WORD.CONNECTING
      : CALL_LIVE_WORD.ENDING;
  }
  return props.muted ? CALL_LIVE_WORD.MUTED : CALL_LIVE_WORD.LIVE;
}

/**
 * A call's status where a message box steers it. While the call is up it
 * is a live mark and "On call", or while the microphone is muted the
 * struck microphone and "Muted" in the quiet ink, since muting is no
 * failure and red is for danger alone, and how long the call has run,
 * counted each second. While it comes up or goes down it is the quiet
 * mark and "Connecting…" or "Ending…", with no count, since no call runs
 * yet or any more. It stands beside the call's controls in the box's foot
 * (`ComposerFoot`'s call), so a call standing reads as one at a glance
 * from the place it is ended. Given a `now` the count stands still at it.
 */
export function CallLive(props: CallLiveProps): React.JSX.Element {
  const live = props.stage === CALL_STAGE.LIVE;
  return (
    <span
      className="luke-call-live"
      data-stage={props.stage}
      data-muted={String(props.stage === CALL_STAGE.LIVE && props.muted)}
    >
      <CallLiveMark props={props} />
      <span className="luke-call-live-word">{callLiveWord(props)}</span>
      {live ? (
        <Time
          at={props.startedAt}
          look={TIME_LOOK.DURATION}
          now={props.now}
          className="luke-call-live-time"
        />
      ) : null}
    </span>
  );
}

/**
 * Video off or Video on: one round button whose glyph says whether the
 * video is up, as a mute's says whether it is on, and whose name says what
 * the press will do. It is named on hover by the system's own hint, since
 * the floating window is too small to hold a tooltip; over a video tile its
 * disc is the round ground itself, never a square inside a circle.
 */
export function VideoToggle({
  on,
  onSetVideo,
}: {
  on: boolean;
  onSetVideo: (on: boolean) => void;
}): React.JSX.Element {
  const label = on ? CALL_CONTROL_LABEL.VIDEO_OFF : CALL_CONTROL_LABEL.VIDEO_ON;
  return (
    <span className="luke-call-video-toggle" title={label}>
      <IconButton
        icon={on ? <VideoIcon /> : <VideoOffIcon />}
        label={label}
        shape={BUTTON_SHAPE.ROUND}
        onClick={() => onSetVideo(!on)}
      />
    </span>
  );
}

/**
 * The call's two lines: the voice's word, and the backend's while it works:
 * "Thinking", or "Working" and the command it runs. Where `titled`, the
 * command carries its whole words as the system's own hint, for the floating
 * window, which is too small to hold a tooltip.
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
  return (
    <span className="luke-call-status">
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.INHERIT}
        truncate
        className="luke-call-status-word"
        data-muted={String(muted)}
      >
        {status?.voiceWord}
      </Text>
      {brain !== undefined ? (
        <span className="luke-call-backend">
          <span className="luke-call-backend-dots">
            <ThinkingDots />
          </span>
          {/* Note that this keeps the system's title, because the floating call window is too short for a pill. */}
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            truncate
            title={titled ? brain.action : undefined}
          >
            {brain.action === undefined ? (
              BRAIN_THINKING
            ) : (
              <>
                {BRAIN_WORKING} · <span className="luke-call-backend-action">{brain.action}</span>
              </>
            )}
          </Text>
          <VisuallyHidden role="status">{TASK_WORKING_LABEL}</VisuallyHidden>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The strip of a call's controls, laid out the way a voice composer's own
 * are: the call's status at the left, and at the right the speaker and
 * microphone mutes, each struck through and lit while on, and End call
 * beside them, apart from both so muting never hangs up. The two mutes'
 * chords are not the bar's to offer: they answer while any call is in
 * progress, wherever the owner stands. A narrow bar stacks its status over
 * its controls rather than cutting the voice's word (call.css).
 */
export function CallBar({
  status,
  microphone,
  speaker,
  onEnd,
  titled = false,
}: {
  /** The call's status, absent while the voice names none, which draws the controls alone. */
  status: CallStatus | undefined;
  microphone: { muted: boolean; onPress: () => void };
  speaker: { muted: boolean; onPress: () => void };
  onEnd: () => void;
  /** Whether Luke's command carries its whole words as the system's hint, where no tooltip fits. */
  titled?: boolean;
}): React.JSX.Element {
  return (
    <footer className="luke-call-bar">
      <CallStatusLines status={status} muted={microphone.muted} titled={titled} />
      <div className="luke-call-controls">
        <div className="luke-call-mutes">
          <CallMute device={CALL_DEVICE.SPEAKER} muted={speaker.muted} onPress={speaker.onPress} />
          <CallMute
            device={CALL_DEVICE.MICROPHONE}
            muted={microphone.muted}
            onPress={microphone.onPress}
          />
        </div>
        <EndCallButton onPress={onEnd} />
      </div>
    </footer>
  );
}
