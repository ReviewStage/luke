/**
 * The introduction's sound: a bell when the face completes, a sweep when the
 * dark lifts, and a small chime at the landing. Everything is synthesized
 * here — no asset, no network, nothing read — and it exists only on the
 * introduction window: the panel keeps its standing rule that Luke's voice is
 * the one thing the app plays. A muted or silenced output skips the whole
 * instrument rather than playing into it, for the same reason captions are
 * the speech there. The introduction never runs in a fixture or capture run,
 * so no deterministic run can hear it.
 */
export class IntroductionAudio {
  #context: AudioContext | undefined;
  readonly #enabled: boolean;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  #ensure(): AudioContext | undefined {
    if (!this.#enabled) return undefined;
    try {
      this.#context ??= new AudioContext({ latencyHint: "playback" });
      return this.#context;
    } catch {
      // A machine with no output device gives up the cues, never the flow.
      return undefined;
    }
  }

  /** A bell: a fundamental and two inharmonic partials on an exponential decay. */
  bell(frequency = 659.25, volume = 0.1, decaySeconds = 1.4): void {
    const context = this.#ensure();
    if (!context) return;
    const now = context.currentTime;
    const partials: readonly { ratio: number; amplitude: number }[] = [
      { ratio: 1, amplitude: 1 },
      { ratio: 2.76, amplitude: 0.32 },
      { ratio: 5.4, amplitude: 0.1 },
    ];
    for (const { ratio, amplitude } of partials) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * ratio;
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume * amplitude, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decaySeconds);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + decaySeconds + 0.1);
    }
  }

  /** Filtered noise rising and falling — the dark lifting off the desktop. */
  sweep(seconds = 1.1): void {
    const context = this.#ensure();
    if (!context) return;
    const now = context.currentTime;
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + seconds * 0.45);
    filter.frequency.exponentialRampToValueAtTime(300, now + seconds);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + seconds * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(now);
  }

  /** The landing: two quick bells a fifth apart. */
  arrive(): void {
    this.bell(987.77, 0.07, 1);
    window.setTimeout(() => this.bell(1_318.5, 0.05, 1.1), 120);
  }

  /** The staged "needs you" flip: one small high bell. */
  ding(): void {
    this.bell(1_174.66, 0.07, 0.8);
  }

  dispose(): void {
    const context = this.#context;
    this.#context = undefined;
    if (context) void context.close().catch(() => undefined);
  }
}
