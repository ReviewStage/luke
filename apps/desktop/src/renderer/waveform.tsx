import { useEffect, useRef, useState } from "react";

const BAR_INDEXES = [0, 1, 2, 3, 4, 5, 6];
const FIXTURE_LEVELS = [0.42, 0.62, 0.82, 1, 0.78, 0.58, 0.38];

export function Waveform({
  analyser,
  speaking = false,
}: {
  analyser?: AnalyserNode;
  speaking?: boolean;
}): React.JSX.Element {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const [voiceActive, setVoiceActive] = useState(false);

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
        setVoiceActive(wasSpeaking);
      }
      bars.current.forEach((bar, index) => {
        if (!bar) return;
        const variation = 0.72 + Math.sin(frame / 9 + index * 0.9) * 0.18;
        bar.style.transform = `scaleY(${0.2 + rms * variation})`;
      });
      frame += 1;
      animationFrame = requestAnimationFrame(draw);
    };
    animationFrame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animationFrame);
      setVoiceActive(false);
    };
  }, [analyser]);

  const isSpeaking = speaking || voiceActive;

  return (
    <span
      className="waveform"
      role="img"
      aria-label="Live speech activity"
      aria-hidden={!isSpeaking}
      data-speaking={String(isSpeaking)}
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
