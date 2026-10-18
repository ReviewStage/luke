/**
 * How long after the last loud frame a voice still counts as speaking, so a
 * breath between two words is not read as the turn ending.
 */
export const VOICE_ACTIVITY_HANGOVER_MS = 220;

/** The loudness a frame must reach to count as a voice at all. */
const VOICE_ACTIVITY_THRESHOLD = 0.12;

/**
 * One frame's loudness from the analyser's time-domain samples, in the unit
 * interval, scaled so ordinary speech fills the meter.
 */
export function frameLevel(samples: Uint8Array): number {
  let energy = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    energy += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(energy / samples.length) * 4.5);
}

/**
 * Whether a voice is still active at `now`, given the last frame that was
 * loud enough to count. Exposed so the hangover can be tested without a clock.
 */
function voiceActiveAt(now: number, lastVoiceAt: number): boolean {
  return now - lastVoiceAt < VOICE_ACTIVITY_HANGOVER_MS;
}

export interface VoiceLevelMeterOptions {
  stream: MediaStream;
  audioContext: AudioContext;
  /**
   * The voice starting and stopping, on the hangover's edge. The session
   * reads this to end Luke's turn when he actually goes quiet, so it is read
   * beside the stream itself: an edge that arrived late would end a turn
   * late.
   */
  onActivity: (active: boolean) => void;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * Listens to one stream and reports whether someone is speaking on it, on a
 * debounced edge. Nothing is drawn from it and no loudness leaves the voice
 * window. Stopping reports the voice inactive, because a stream that goes
 * away takes its speech with it and the session is still standing to be
 * told so.
 */
export function startVoiceLevelMeter(options: VoiceLevelMeterOptions): () => void {
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const { audioContext } = options;
  // A suspended context reads a flatline whatever the stream carries, and no
  // user gesture in a hidden window has ever vouched for it. Resuming is a
  // no-op when it is already running.
  if (audioContext.state === "suspended") void audioContext.resume();
  const source = audioContext.createMediaStreamSource(options.stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.82;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  let wasActive = false;
  let lastVoiceAt = Number.NEGATIVE_INFINITY;
  let frame = 0;
  const measure = () => {
    analyser.getByteTimeDomainData(samples);
    const level = frameLevel(samples);
    const at = now();
    if (level > VOICE_ACTIVITY_THRESHOLD) lastVoiceAt = at;
    const active = voiceActiveAt(at, lastVoiceAt);
    if (active !== wasActive) {
      wasActive = active;
      options.onActivity(active);
    }
    frame = requestFrame(measure);
  };
  frame = requestFrame(measure);

  return () => {
    cancelFrame(frame);
    source.disconnect();
    options.onActivity(false);
  };
}
