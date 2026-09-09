import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_CLIENT_EVENT } from "@sidecar/realtime";
import { text, type WireRecord } from "@sidecar/wire";
import type { PressCaptureSource } from "./press-audio-capture";
import { type MicrophoneSender, PressTurnCapture } from "./press-turn-capture";

interface Harness {
  capture: PressTurnCapture;
  sent: WireRecord[];
  /** Hands one chunk to whatever capture is reading, as the audio graph would. */
  speak(...samples: number[]): void;
  /** Whether a capture is reading the device now. */
  reading: () => boolean;
  track: { enabled: boolean };
  replaced: (MediaStreamTrack | null)[];
  /** Takes the device away, as a teardown or a release does. */
  closeDevice: () => void;
  disconnect: () => void;
}

/** The capture hands the stream straight to the injected source and never reads it. */
function asStream(): MediaStream {
  // SAFETY: the injected capture source is this file's own and ignores its stream.
  return {} as MediaStream;
}

/** The capture reads and writes one member of the track: whether it is enabled. */
function asTrack(track: { enabled: boolean }): MediaStreamTrack {
  // SAFETY: the capture only opens and closes the track, and hands it to the sender.
  return track as unknown as MediaStreamTrack;
}

function harness(): Harness {
  const sent: WireRecord[] = [];
  const replaced: (MediaStreamTrack | null)[] = [];
  const track = { enabled: false };
  let onChunk: ((chunk: Int16Array) => void) | undefined;
  let device = true;
  let connected = true;
  const sender: MicrophoneSender = {
    replaceTrack: (next) => {
      replaced.push(next);
      return Promise.resolve();
    },
  };
  const capture = new PressTurnCapture({
    send: (events) => sent.push(...events),
    createSource: (_stream, chunkHandler): PressCaptureSource => {
      onChunk = chunkHandler;
      return {
        stop: () => {
          onChunk = undefined;
        },
      };
    },
    device: () => (device ? { stream: asStream(), track: asTrack(track), sender } : undefined),
    connected: () => connected,
  });
  return {
    capture,
    sent,
    speak: (...samples) => onChunk?.(Int16Array.from(samples)),
    reading: () => onChunk !== undefined,
    track,
    replaced,
    closeDevice: () => {
      device = false;
    },
    disconnect: () => {
      connected = false;
    },
  };
}

function types(sent: readonly WireRecord[]): readonly string[] {
  return sent.map((event) => {
    const type = text(event.type);
    assert.ok(type, "every event sent names its type");
    return type;
  });
}

const FLUSH_OPENING = [
  REALTIME_CLIENT_EVENT.SESSION_UPDATE,
  REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
] as const;

test("the words spoken into the handshake are held rather than sent", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1, 2, 3);

  assert.equal(context.capture.active, true);
  assert.equal(context.capture.empty, false);
  assert.deepEqual(context.sent, []);
});

test("the track opens exactly while the capture reads it", () => {
  const context = harness();
  context.capture.begin();
  assert.equal(context.track.enabled, true);

  context.capture.reset();

  assert.equal(context.track.enabled, false);
  assert.equal(context.reading(), false);
});

test("with no device open there is nothing to capture", () => {
  const context = harness();
  context.closeDevice();
  context.capture.begin();

  assert.equal(context.capture.active, false);
  assert.equal(context.reading(), false);
});

test("asking twice does not start a second capture over the first", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1);
  context.capture.begin();
  context.speak(2);

  // One source reading, and both presses' words in the one buffer.
  context.capture.openTurn();
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND)
      .length,
    2,
  );
});

test("the turn opens on the held words and streams live from there", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1);

  context.capture.openTurn();

  // The format the appends are to be read as, then a clear, then the words —
  // appends ahead of either are read against whatever the last turn left.
  assert.deepEqual(types(context.sent), [
    ...FLUSH_OPENING,
    REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND,
  ]);
  assert.equal(context.capture.onAppends, true);

  context.sent.length = 0;
  context.speak(2);
  assert.deepEqual(types(context.sent), [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND]);
});

test("a release mid-handshake stops reading the device but keeps the words", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1);

  context.capture.seal();

  assert.equal(context.reading(), false);
  assert.equal(context.capture.commitPending, true);
  assert.equal(context.capture.active, true);
  assert.deepEqual(context.sent, []);
});

test("a sealed capture never hands the sender a live microphone", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1);

  // The press is released mid-handshake, so nothing reads the device any more.
  // A track left open here rides onto the sender when the capture retires.
  context.capture.seal();
  assert.equal(context.track.enabled, false);

  context.capture.deliverSealed();

  // The seam still hands the track to the sender — that is what lets the next
  // turn ride WebRTC — but a disabled track transmits silence.
  assert.deepEqual(context.replaced, [asTrack(context.track)]);
  assert.equal(context.track.enabled, false);
});

test("the sealed words are delivered once and the capture retires with them", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1);
  context.capture.seal();

  assert.equal(context.capture.deliverSealed(), true);
  assert.deepEqual(types(context.sent), [
    ...FLUSH_OPENING,
    REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND,
  ]);
  assert.equal(context.capture.active, false);
  assert.equal(context.capture.commitPending, false);

  context.sent.length = 0;
  assert.equal(context.capture.deliverSealed(), false);
  assert.deepEqual(context.sent, []);
});

test("a press still held owes no delivery", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1);

  assert.equal(context.capture.deliverSealed(), false);
  assert.deepEqual(context.sent, []);
});

test("a press landing again over sealed words re-opens the same turn", () => {
  const context = harness();
  context.capture.begin();
  context.speak(1);
  context.capture.seal();

  // The delivery the release was owed is superseded — this press's own
  // release decides afresh — and capture resumes into the same buffer.
  context.capture.begin();
  context.speak(2);

  assert.equal(context.capture.commitPending, false);
  context.capture.openTurn();
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND)
      .length,
    2,
  );
});

test("the retired capture hands the track to the sender for the turns after the seam", () => {
  const context = harness();
  context.capture.begin();

  context.capture.reset();

  assert.deepEqual(context.replaced, [asTrack(context.track)]);
});

test("a capture retired with no call left hands the track nowhere", () => {
  const context = harness();
  context.capture.begin();
  context.disconnect();

  context.capture.reset();

  assert.deepEqual(context.replaced, []);
});

test("a chunk from a capture already let go of goes nowhere", () => {
  const context = harness();
  context.capture.begin();
  context.capture.openTurn();
  const speakLate = context.speak;

  // The source is stopped by the reset, but a chunk already in flight from
  // the audio graph must not append itself to whatever turn comes next.
  context.capture.reset();
  context.sent.length = 0;
  speakLate(1);

  assert.deepEqual(context.sent, []);
  assert.equal(context.capture.onAppends, false);
});
