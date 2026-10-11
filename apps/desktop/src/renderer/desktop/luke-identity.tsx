import { WingFace } from "@sidecar/panel";
import { useRef } from "react";
import {
  SILENT_VOICE_LEVELS,
  type VoiceLevels,
  type VoiceSpeakers,
} from "#shared/messages/voice-view";
import { speechFaceInputs, useFaceHover, useFaceMotion } from "../luke-face-mood";
import { usePrefersReducedMotion } from "../use-reduced-motion";
import type { VoiceActivity } from "../use-voice-view";
import { WAVEFORM_VOICE, Waveform, type WaveformVoice } from "../waveform";

/** What the card says about the voice, in the words it says it. */
const VOICE_STATUS = {
  OPENING: "Connecting",
  LISTENING: "Listening",
  SPEAKING: "Speaking",
} as const;

type VoiceStatus = (typeof VOICE_STATUS)[keyof typeof VOICE_STATUS];

/**
 * The one line of voice state the card draws. Luke speaking wins over the
 * microphone, because the session is full duplex and his answer is what the
 * developer is waiting on; a call still opening is said as such so the talk
 * key answers on the frame it lands.
 */
export function voiceStatus(input: {
  speakers: VoiceSpeakers;
  voiceOpening: boolean;
}): VoiceStatus | undefined {
  if (input.speakers.lukeSpeaking) return VOICE_STATUS.SPEAKING;
  if (input.speakers.listening) return VOICE_STATUS.LISTENING;
  if (input.voiceOpening) return VOICE_STATUS.OPENING;
  return undefined;
}

export interface LukeIdentityProps {
  levels?: VoiceLevels;
  speakers: VoiceSpeakers;
  voiceActive: VoiceActivity;
  fixtureSpeaking: boolean;
  voiceOpening: boolean;
}

/**
 * Luke at the head of the sidebar: his face, reacting to the voice, and his
 * name. During a call one line under the name says what the voice is doing,
 * with a meter for whoever is talking; at rest there is nothing to say, so
 * the name stands alone.
 */
export function LukeIdentity({
  levels = SILENT_VOICE_LEVELS,
  speakers,
  voiceActive,
  fixtureSpeaking,
  voiceOpening,
}: LukeIdentityProps): React.JSX.Element {
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(
    speechFaceInputs(speakers),
    usePrefersReducedMotion(),
    useFaceHover(faceElement),
  );
  const status = voiceStatus({ speakers, voiceOpening });
  const meterVoice: WaveformVoice | undefined =
    status === VOICE_STATUS.SPEAKING
      ? WAVEFORM_VOICE.LUKE
      : status === VOICE_STATUS.LISTENING
        ? WAVEFORM_VOICE.DEVELOPER
        : undefined;

  return (
    <div className="luke-identity" data-turn={meterVoice}>
      <span className="luke-identity-face" ref={faceElement}>
        <WingFace key={face.play} motion={face.motion} repeat={face.repeat} />
      </span>
      <span className="luke-identity-copy">
        <span className="luke-identity-name">Luke</span>
        {status ? (
          <span className="luke-identity-status" role="status">
            {status}
          </span>
        ) : null}
      </span>
      {meterVoice ? (
        <span className="wing-meter luke-identity-meter" data-turn={meterVoice}>
          <Waveform
            level={levels[meterVoice]}
            speaking={fixtureSpeaking}
            voice={meterVoice}
            voiceActive={voiceActive[meterVoice]}
          />
        </span>
      ) : null}
    </div>
  );
}
