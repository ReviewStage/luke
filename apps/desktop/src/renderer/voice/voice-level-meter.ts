/**
 * How long after the last loud frame a voice still counts as speaking, so a
 * breath between two words is not read as the turn ending.
 */
export const VOICE_ACTIVITY_HANGOVER_MS = 220;

/** The loudness a frame must reach to count as a voice at all. */
export const VOICE_ACTIVITY_THRESHOLD = 0.12;

/**
 * The fastest the level may be reported. The panels draw from a relayed
 * scalar rather than the stream, and a meter is legible well below the frame
 * rate; anything heavier would be paying IPC for a detail nobody can see.
 */
export const VOICE_LEVEL_REPORT_INTERVAL_MS = 50;

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
export function voiceActiveAt(now: number, lastVoiceAt: number): boolean {
  return now - lastVoiceAt < VOICE_ACTIVITY_HANGOVER_MS;
}

export interface VoiceLevelMeterOptions {
  stream: MediaStream;
  audioContext: AudioContext;
  /**
   * The voice starting and stopping, on the hangover's edge. The session
   * reads this to end Luke's turn when he actually goes quiet, so it must
   * stay beside the stream rather than ride the relay: a level that arrived
   * late would end a turn late.
   */
  onActivity: (active: boolean) => void;
  /** The loudness, at most once per {@link VOICE_LEVEL_REPORT_INTERVAL_MS}. */
  onLevel: (level: number) => void;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * Listens to one stream and reports two things about it: whether someone is
 * speaking, on a debounced edge, and how loud they are, at a bounded rate.
 * Nothing is drawn here; the panels draw from what the main process relays.
 * Stopping reports the voice inactive, because a stream that goes away takes
 * its speech with it and the session is still standing to be told so.
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
  let lastReportAt = Number.NEGATIVE_INFINITY;
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
    if (at - lastReportAt >= VOICE_LEVEL_REPORT_INTERVAL_MS) {
      lastReportAt = at;
      options.onLevel(level);
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
