/**
 * call-controls.tsx -- a call's controls: its two mutes, the one red End call, and the bar that lays them out beside the call's status.
 *
 * The call card draws these, so a mute and the way to hang up wear the same
 * words, glyphs, and colours wherever it stands. Each takes what it shows and the press it hands back,
 * and decides nothing: whether a call stands, what its status says, and
 * what a press asks of the voice are the owner's. End call is the one red
 * control, on the danger fill with the hang-up glyph (`GLYPH.END_CALL`),
 * because ending a call cannot be undone; a mute is quiet while off and lit
 * in neutral grey while on, its glyph struck through, since muting is no
 * failure.
 */

import {
  type CallStatus,
  MUTE_MICROPHONE_LABEL,
  UNMUTE_MICROPHONE_LABEL,
} from "../../call-card-model.js";
import {
  MicrophoneIcon,
  MicrophoneOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from "../../face/glyphs.js";
import { GLYPH } from "../../icons/glyph-registry.js";
import { BUTTON_SHAPE, BUTTON_VARIANT, IconButton } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { ThinkingDots } from "../thinking-dots/thinking-dots.js";
import { Tooltip } from "../tooltip/hint.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/** What a reader is told while the backend works; the sighted read the dots and the line. */
const TASK_WORKING_LABEL = "Luke is working on it";

/** The backend line's words, subject-free like the voice's: what Luke says with no command pending, and what leads the command he runs. */
const AGENT_THINKING = "Thinking";
const AGENT_WORKING = "Working";

/** Each call control's name for a reader and its hover, by whether it is on. */
export const CALL_CONTROL_LABEL = {
  MUTE_MICROPHONE: MUTE_MICROPHONE_LABEL,
  UNMUTE_MICROPHONE: UNMUTE_MICROPHONE_LABEL,
  MUTE_SPEAKER: "Mute speaker",
  UNMUTE_SPEAKER: "Unmute speaker",
  END_CALL: "End call",
} as const;

/** What a mute silences: the developer's microphone, or Luke's voice on this Mac alone. */
export const CALL_DEVICE = {
  MICROPHONE: "microphone",
  SPEAKER: "speaker",
} as const;

export type CallDevice = (typeof CALL_DEVICE)[keyof typeof CALL_DEVICE];

/** Each device's mute: its names off and on, and its glyphs off and on. */
const MUTE = {
  [CALL_DEVICE.MICROPHONE]: {
    mute: CALL_CONTROL_LABEL.MUTE_MICROPHONE,
    unmute: CALL_CONTROL_LABEL.UNMUTE_MICROPHONE,
    Live: MicrophoneIcon,
    Muted: MicrophoneOffIcon,
  },
  [CALL_DEVICE.SPEAKER]: {
    mute: CALL_CONTROL_LABEL.MUTE_SPEAKER,
    unmute: CALL_CONTROL_LABEL.UNMUTE_SPEAKER,
    Live: SpeakerIcon,
    Muted: SpeakerOffIcon,
  },
} as const;

/**
 * A mute the call offers, round in the call bar: named for what the press
 * will do, and its glyph struck through, lit in neutral grey, while muted.
 */
export function CallMute({
  device,
  muted,
  onPress,
}: {
  device: CallDevice;
  muted: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const mute = MUTE[device];
  const label = muted ? mute.unmute : mute.mute;
  return (
    <Tooltip label={label}>
      <IconButton
        variant={BUTTON_VARIANT.QUIET}
        shape={BUTTON_SHAPE.ROUND}
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

/**
 * The call bar's own row, laid out as a voice composer's controls are: the
 * call's two lines at its left and its controls at its right. Its least
 * height holds both lines, so it never moves as the backend's line comes
 * and goes, but where it is too narrow for the call on one row. It answers
 * its own width, as the floating window draws it.
 */
const BAR =
  "luke-call-bar @container/luke-call-bar mx-auto my-0 flex min-h-call-row max-w-call-row-max flex-wrap items-center gap-x-block-gap gap-y-control-gap";

/**
 * The call's two lines, each cut short on one line, so a long command never
 * wraps the row or pushes the controls, and the dots are never cut. Too
 * narrow for the status beside the controls (an off-scale 210px), the
 * status takes a row of its own, the
 * voice's word whole, and the controls stand under it at the right. The
 * floating window's bar is wider than this and must stay so, since its
 * window's height is fixed.
 */
const STATUS =
  "luke-call-status flex min-w-0 flex-1 flex-col gap-luke-2 whitespace-nowrap @max-[210px]/luke-call-bar:basis-full";

/**
 * The backend's line, in the caption's muted voice. Narrower than an
 * off-scale 280px, a call card's controls at its head's step, the working
 * dots go, the line's own words saying Luke works, so Luke's command keeps
 * their room.
 */
const BACKEND =
  "luke-call-backend flex min-w-0 items-center gap-control-gap text-caption text-muted-foreground";
const BACKEND_DOTS = "luke-call-backend-dots flex @max-[280px]/luke-call-bar:hidden";
const BACKEND_ACTION = "luke-call-backend-action font-mono";

/**
 * End call stands apart from the two mutes, so muting never hangs up; at a
 * call card's narrowest the controls close up to a card head's own step, so
 * its mutes and End call stand under its way back.
 */
const CONTROLS =
  "luke-call-controls ml-auto flex flex-none items-center gap-control-gap @max-[280px]/luke-call-bar:gap-tight-gap";
const MUTES = "luke-call-mutes flex flex-none items-center gap-tight-gap";

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
  const agent = status?.backend.agent;
  return (
    <span className={STATUS}>
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.INHERIT}
        truncate
        className="luke-call-status-word data-[muted=true]:text-muted-foreground"
        data-muted={String(muted)}
      >
        {status?.voiceWord}
      </Text>
      {agent !== undefined ? (
        <span className={BACKEND}>
          <span className={BACKEND_DOTS}>
            <ThinkingDots />
          </span>
          {/* Note that this keeps the system's title, because the floating call window is too short for a pill. */}
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            truncate
            title={titled ? agent.action : undefined}
          >
            {agent.action === undefined ? (
              AGENT_THINKING
            ) : (
              <>
                {AGENT_WORKING} · <span className={BACKEND_ACTION}>{agent.action}</span>
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
 * beside them, apart from both so muting never hangs up. A narrow bar stacks
 * its status over its controls rather than cutting the voice's word
 * (`STATUS`).
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
    <footer className={BAR}>
      <CallStatusLines status={status} muted={microphone.muted} titled={titled} />
      <div className={CONTROLS}>
        <div className={MUTES}>
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
