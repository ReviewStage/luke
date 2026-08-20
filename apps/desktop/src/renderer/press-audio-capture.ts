import { PRESS_AUDIO_SAMPLE_RATE } from "@sidecar/realtime";

/**
 * Reads PCM off the microphone stream the connect attempt already opened, so
 * the words spoken while the call is still connecting can be appended to the
 * turn once the data channel opens. It captures nothing the WebRTC track
 * would not carry a moment later, holds nothing itself — every chunk goes to
 * the callback — and it runs only while a press holds a turn: the session
 * that creates it stops it at release, at the seam, and at every teardown.
 */
export interface PressCaptureSource {
  stop(): void;
}

export type PressCaptureFactory = (
  stream: MediaStream,
  onChunk: (chunk: Int16Array) => void,
) => PressCaptureSource;

/**
 * How many samples one captured chunk holds — about 85ms at the capture rate.
 * The processor hands audio over a quantum at a time, and its last partial
 * quantum is lost when capture stops, so the size is a floor under how close
 * to the release the captured audio can end: small enough that letting go of
 * the key costs less than a syllable, large enough not to flood the channel.
 */
export const PRESS_CAPTURE_CHUNK_SAMPLES = 2_048;

/**
 * Captures the stream at the rate the appends need. The context is created at
 * `PRESS_AUDIO_SAMPLE_RATE`, so the engine resamples the device's own rate on
 * the way in and the chunks need no conversion of this module's own.
 */
export const createPressCaptureSource: PressCaptureFactory = (stream, onChunk) => {
  const context = new AudioContext({ sampleRate: PRESS_AUDIO_SAMPLE_RATE });
  // The talk key is a system shortcut, so no user gesture in this window has
  // vouched for the context — the analyser's own reason, and the same answer.
  if (context.state === "suspended") void context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(PRESS_CAPTURE_CHUNK_SAMPLES, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const chunk = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = input[index] ?? 0;
      chunk[index] = Math.max(-32_768, Math.min(32_767, Math.round(sample * 32_767)));
    }
    onChunk(chunk);
  };
  source.connect(processor);
  // The processor only runs while it reaches the destination. Its output
  // buffer is left at zeros, so nothing of the microphone reaches the speakers.
  processor.connect(context.destination);
  return {
    stop: () => {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      void context.close().catch(() => undefined);
    },
  };
};
