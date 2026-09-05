import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./luke-face-mood";
import { frameLevel, VOICE_ACTIVITY_THRESHOLD, voiceActiveAt } from "./voice/voice-level-meter";

/**
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
 * How much of the way to the relayed level each frame travels. The level
 * arrives at a bounded rate from the voice window, and the bars ease toward
 * it between arrivals rather than stepping, so the meter reads as a voice.
 */
const LEVEL_EASING = 0.35;

/**
 * The meter draws what it is handed, from one of two sources. The panel hands
 * it the loudness the voice window measured and the main process relayed;
 * the introduction takeover, which holds a session of its own, hands it the
 * analyser on that stream and is told the voice's edges back. Whether
 * someone is speaking is a fact the wing and the face both act on, so the
 * bars only report it — they never decide it twice.
 */
export function Waveform({
  analyser,
  level = 0,
  speaking = false,
  voice,
  voiceActive = false,
  connecting = false,
  onVoiceActivity,
}: {
  /** A stream to measure here, where the panel has none: the takeover's own. */
  analyser?: AnalyserNode;
  /** How loud whoever is talking is, in the unit interval, as last relayed. */
  level?: number;
  speaking?: boolean;
  /** Whose turn the bars are drawing, which is what colours them. */
  voice?: WaveformVoice;
  voiceActive?: boolean;
  /**
   * The press has landed but the call is still opening, so there is nothing to
   * hear yet. The bars pulse on their own clock rather than sit at the floor —
   * a press that changes nothing on screen reads as a press that did nothing —
   * and stop pretending the moment a level takes over.
   */
  connecting?: boolean;
  /** The measured voice's edges, reported only where an analyser is measured. */
  onVoiceActivity?: (active: boolean) => void;
}): React.JSX.Element {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const target = useRef(level);
  target.current = level;
  const report = useRef(onVoiceActivity);
  report.current = onVoiceActivity;
  // Reduced motion stills the bars but not the listening: a measured stream
  // keeps being measured and reported — whether someone is speaking is a fact
  // the wing and the face both act on — and only the per-frame drawing is
  // withheld.
  const reduced = usePrefersReducedMotion();
  const live = voice !== undefined;

  useEffect(() => {
    // Fixture speech is intentionally static so screenshots and recordings are
    // repeatable. Only a live turn needs animation frames.
    if (!analyser && (!live || reduced)) {
      // Bars a livelier moment already lifted go back to the stylesheet's rest,
      // rather than freezing at whatever height the last frame drew.
      for (const bar of bars.current) bar?.style.removeProperty("transform");
      return;
    }
    const samples = analyser ? new Uint8Array(analyser.fftSize) : undefined;
    let frame = 0;
    let animationFrame = 0;
    let wasSpeaking = false;
    let lastVoiceAt = Number.NEGATIVE_INFINITY;
    let shown = 0;
    const draw = () => {
      if (analyser && samples) {
        analyser.getByteTimeDomainData(samples);
        shown = frameLevel(samples);
        const now = performance.now();
        if (shown > VOICE_ACTIVITY_THRESHOLD) lastVoiceAt = now;
        const nextSpeaking = voiceActiveAt(now, lastVoiceAt);
        if (nextSpeaking !== wasSpeaking) {
          wasSpeaking = nextSpeaking;
          report.current?.(wasSpeaking);
        }
      } else {
        shown += (target.current - shown) * LEVEL_EASING;
      }
      if (!reduced) {
        bars.current.forEach((bar, index) => {
          if (!bar) return;
          const variation = 0.72 + Math.sin(frame / 9 + index * 0.9) * 0.18;
          bar.style.transform = `scaleY(${0.2 + shown * variation})`;
        });
      }
      frame += 1;
      animationFrame = requestAnimationFrame(draw);
    };
    if (reduced) {
      for (const bar of bars.current) bar?.style.removeProperty("transform");
    }
    animationFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrame);
      // A measured stream that goes away takes its speech with it, and the
      // face is still on screen to be told so.
      if (analyser) report.current?.(false);
    };
  }, [analyser, live, reduced]);

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
