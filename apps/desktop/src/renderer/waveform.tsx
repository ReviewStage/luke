import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./luke-face-mood";

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * Five, because the meter is as wide as the face it is drawn beside or in place
 * of, and five 2px bars with 2px between them is what 18px holds.
 */
const BAR_INDEXES = [0, 1, 2, 3, 4];
const FIXTURE_LEVELS = [0.46, 0.74, 1, 0.7, 0.42];

/** Whose voice the meter is drawing, which is what colours it. */
export const WAVEFORM_VOICE = {
  DEVELOPER: "developer",
  LUKE: "luke",
} as const;

export type WaveformVoice = (typeof WAVEFORM_VOICE)[keyof typeof WAVEFORM_VOICE];

/**
 * The meter reports speech; it does not own the fact. Luke's face answers the
 * same signal from the other side of the housing, and two components deciding
 * separately whether someone is talking would eventually disagree — so the bars
 * report what they hear and the wing holds the answer.
 */
export function Waveform({
  analyser,
  speaking = false,
  voice,
  voiceActive = false,
  connecting = false,
  onVoiceActivity,
}: {
  analyser?: AnalyserNode;
  speaking?: boolean;
  /** Whose turn the bars are drawing, which is what colours them. */
  voice?: WaveformVoice;
  voiceActive?: boolean;
  /**
   * The press has landed but the call is still opening, so there is nothing to
   * hear yet. The bars pulse on their own clock rather than sit at the floor —
   // SAFETY: The preceding check establishes the asserted contract.
   * a press that changes nothing on screen reads as a press that did nothing —
   * and stop pretending the moment an analyser takes over.
   */
  connecting?: boolean;
  onVoiceActivity?: (active: boolean) => void;
}): React.JSX.Element {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const report = useRef(onVoiceActivity);
  report.current = onVoiceActivity;
  // Reduced motion stills the bars but not the listening: the loop keeps
  // measuring and reporting — whether someone is speaking is a fact the wing
  // and the face both act on — and only the per-frame drawing is withheld.
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    // Fixture speech is intentionally static so screenshots and recordings are
    // repeatable. Only a live microphone analyser needs animation frames.
    if (!analyser) return;

    const values = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let animationFrame = 0;
    let wasSpeaking = false;
    let lastVoiceAt = 0;
    const draw = () => {
      let rms = 0;
      analyser.getByteTimeDomainData(values);
      let energy = 0;
      for (const value of values) {
        const normalized = (value - 128) / 128;
        energy += normalized * normalized;
      }
      rms = Math.min(1, Math.sqrt(energy / values.length) * 4.5);
      const now = performance.now();
      if (rms > 0.12) lastVoiceAt = now;
      const nextSpeaking = now - lastVoiceAt < 220;
      if (nextSpeaking !== wasSpeaking) {
        wasSpeaking = nextSpeaking;
        report.current?.(wasSpeaking);
      }
      if (!reduced) {
        bars.current.forEach((bar, index) => {
          if (!bar) return;
          const variation = 0.72 + Math.sin(frame / 9 + index * 0.9) * 0.18;
          bar.style.transform = `scaleY(${0.2 + rms * variation})`;
        });
      }
      frame += 1;
      animationFrame = requestAnimationFrame(draw);
    };
    // Bars a livelier moment already lifted go back to the stylesheet's rest,
    // rather than freezing at whatever height the last frame drew.
    if (reduced) {
      for (const bar of bars.current) bar?.style.removeProperty("transform");
    }
    animationFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrame);
      // A microphone that goes away takes its speech with it, and the face is
      // still on screen to be told so.
      report.current?.(false);
    };
  }, [analyser, reduced]);

  const isSpeaking = speaking || voiceActive;

  return (
    <span
      className="waveform"
      role="img"
      aria-label={
        connecting
          ? "Voice is connecting"
          : voice === WAVEFORM_VOICE.LUKE
            ? "Luke is speaking"
            : "Live speech activity"
      }
      aria-hidden={!isSpeaking && !connecting}
      data-speaking={String(isSpeaking)}
      data-connecting={String(connecting)}
      data-voice={voice}
    >
      {BAR_INDEXES.map((index) => (
        <span
          className="waveform-bar"
          key={index}
          ref={(element) => {
            bars.current[index] = element;
          }}
          style={speaking ? { transform: `scaleY(${FIXTURE_LEVELS[index]})` } : undefined}
        />
      ))}
    </span>
  );
}
