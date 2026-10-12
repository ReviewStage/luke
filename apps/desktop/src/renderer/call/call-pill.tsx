/**
 * call-pill.tsx -- the floating call window's one surface: Luke, the call's plan, and its controls.
 *
 * Drawn in its own transparent window while the call's plan is off screen.
 * It carries no words of the conversation, mounts no recorder (the window's
 * role never mounts `App`), and holds nothing of its own: it draws the
 * document's voice view and plan names, and every press is an act main
 * validates and hands to the voice window, which holds the call.
 */

import { IDLE_PLANNING_VIEW } from "@sidecar/hosted/planning-view";
import {
  CloseIcon,
  ExternalIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  WingFace,
} from "@sidecar/panel";
import { useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { VOICE_COMMAND, type VoiceLevels } from "#shared/messages/voice-view";
import { type ActHandle, useAct } from "../act";
import { speechFaceInputs, useFaceHover, useFaceMotion } from "../luke-face-mood";
import { CALL_CONTROL_LABEL } from "../planning/planning-parts";
import { useAppState } from "../use-app-state";
import { usePrefersReducedMotion } from "../use-reduced-motion";
import { useVoiceView, type VoiceActivity } from "../use-voice-view";
import { WAVEFORM_VOICE, Waveform } from "../waveform";
import { type CallPill as CallPillModel, callPill } from "./call-pill-model";

/** The way back's name, for a reader and its hover. */
export const RETURN_TO_PLAN_LABEL = "Return to the plan";

/** The pill's four presses. */
export interface CallControls {
  onReturn: () => void;
  onToggleMicrophone: () => void;
  onToggleSpeaker: () => void;
  onEnd: () => void;
}

/**
 * Each press as the act it is: the way back is main's to answer on the call's
 * own plan, and the three call controls are the voice window's, about the
 * call standing, so none of them names a plan.
 */
export function callControls(tell: ActHandle["tell"], speakerMuted: boolean): CallControls {
  const command = (sent: (typeof VOICE_COMMAND)[keyof typeof VOICE_COMMAND]) =>
    tell(ACT_KIND.VOICE_COMMAND, { command: sent });
  return {
    onReturn: () => tell(ACT_KIND.CALL_SHOW_PLAN),
    onToggleMicrophone: () => command(VOICE_COMMAND.TOGGLE_MICROPHONE),
    onToggleSpeaker: () =>
      command(speakerMuted ? VOICE_COMMAND.UNMUTE_SPEAKER : VOICE_COMMAND.MUTE_SPEAKER),
    onEnd: () => command(VOICE_COMMAND.END_CALL),
  };
}

/** One round control; a mute is struck through, and filled, while it is on. */
function PillButton({
  label,
  pressed,
  className,
  onPress,
  children,
}: {
  label: string;
  pressed?: boolean;
  className: string;
  onPress: () => void;
  children: React.JSX.Element;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`call-pill-button ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/**
 * The pill as drawn from what it is handed. Everything but the four buttons
 * is the window's drag handle, so the pill moves wherever it is held. Note
 * that the plan's name is not also the way back, because macOS hands a press
 * on a drag region to the drag and never to the page.
 */
export function CallPillView({
  pill,
  speakerMuted,
  levels,
  voiceActive,
  controls,
}: {
  pill: CallPillModel;
  speakerMuted: boolean;
  levels: VoiceLevels;
  voiceActive: VoiceActivity;
  controls: CallControls;
}): React.JSX.Element {
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(
    speechFaceInputs({
      lukeSpeaking: pill.meterVoice === WAVEFORM_VOICE.LUKE,
      listening: pill.meterVoice === WAVEFORM_VOICE.DEVELOPER,
    }),
    usePrefersReducedMotion(),
    useFaceHover(faceElement),
  );
  const microphoneLabel = pill.microphoneMuted
    ? CALL_CONTROL_LABEL.UNMUTE_MICROPHONE
    : CALL_CONTROL_LABEL.MUTE_MICROPHONE;
  const speakerLabel = speakerMuted
    ? CALL_CONTROL_LABEL.UNMUTE_SPEAKER
    : CALL_CONTROL_LABEL.MUTE_SPEAKER;
  return (
    <div className="call-pill" data-tone={pill.status.tone}>
      <span className="call-pill-identity">
        <span className="call-pill-face" ref={faceElement} data-muted={pill.microphoneMuted}>
          <WingFace key={face.play} motion={face.motion} repeat={face.repeat} />
        </span>
        <span className="call-pill-copy">
          <span className="call-pill-plan">{pill.planName}</span>
          <span className="call-pill-status" role="status">
            {pill.status.words}
          </span>
        </span>
      </span>
      {pill.meterVoice ? (
        <span className="wing-meter call-pill-meter" data-turn={pill.meterVoice}>
          <Waveform
            level={levels[pill.meterVoice]}
            voice={pill.meterVoice}
            voiceActive={voiceActive[pill.meterVoice]}
          />
        </span>
      ) : null}
      <span className="call-pill-controls">
        <PillButton
          label={RETURN_TO_PLAN_LABEL}
          className="call-pill-return"
          onPress={controls.onReturn}
        >
          <ExternalIcon />
        </PillButton>
        <PillButton
          label={microphoneLabel}
          pressed={pill.microphoneMuted}
          className="call-pill-toggle"
          onPress={controls.onToggleMicrophone}
        >
          {pill.microphoneMuted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
        </PillButton>
        <PillButton
          label={speakerLabel}
          pressed={speakerMuted}
          className="call-pill-toggle"
          onPress={controls.onToggleSpeaker}
        >
          {speakerMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
        </PillButton>
        <PillButton
          label={CALL_CONTROL_LABEL.END_CALL}
          className="call-pill-end"
          onPress={controls.onEnd}
        >
          <CloseIcon />
        </PillButton>
      </span>
    </div>
  );
}

/** The call window's root: the pill over the document it is handed. */
export function CallPill(): React.JSX.Element {
  const { tell } = useAct();
  const state = useAppState();
  const voice = useVoiceView();
  const pill = callPill({ view: voice.view, planning: state?.planning ?? IDLE_PLANNING_VIEW });
  return (
    <CallPillView
      pill={pill}
      speakerMuted={voice.view.speakerMuted}
      levels={voice.levels}
      voiceActive={voice.voiceActive}
      controls={callControls(tell, voice.view.speakerMuted)}
    />
  );
}
