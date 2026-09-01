import assert from "node:assert/strict";
import test from "node:test";
import { ELEVENLABS_KEEP_ALIVE_MS, TOKEN_MINT_OUTCOME } from "@sidecar/speech";
import type { SpeechTokenAnswer } from "#shared/contracts";
import { ElevenLabsSpeech, type SpeechAudioSink, type SpeechSocket } from "./speech-output";

const VOICE_ID = "voice-1";

/** One server frame, as the fixtures spell the fields the driver reads. */
interface DialogueFrameFixture {
  audio?: string;
  is_final?: boolean;
  is_final_audio_for_turn?: boolean;
  error?: string;
  message?: string;
}

/** Two 16-bit little-endian samples, base64, as one server frame carries them. */
const AUDIO_FRAME = btoa(String.fromCharCode(0, 0, 0, 0x40));

function fakeSink() {
  const played: number[] = [];
  let pendingMs = 0;
  let stops = 0;
  let closes = 0;
  const sink: SpeechAudioSink = {
    // SAFETY: These tests exercise the socket driver, which reads the stream's
    // identity and never its tracks; nothing here touches a media device.
    stream: undefined as unknown as MediaStream,
    play(samples) {
      played.push(samples.length);
    },
    pendingMs: () => pendingMs,
    stop() {
      stops += 1;
      pendingMs = 0;
    },
    close() {
      closes += 1;
    },
  };
  return {
    sink,
    played,
    setPending: (value: number) => {
      pendingMs = value;
    },
    stops: () => stops,
    closes: () => closes,
  };
}

function fakeSocket() {
  const sent: string[] = [];
  let closed = false;
  const socket: SpeechSocket = {
    readyState: 0,
    send: (payload) => {
      sent.push(payload);
    },
    close: () => {
      closed = true;
    },
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };
  return {
    socket,
    sent,
    closed: () => closed,
    open() {
      socket.readyState = 1;
      socket.onopen?.(new Event("open"));
    },
    deliver(frame: DialogueFrameFixture) {
      // SAFETY: The driver reads only `data`; the rest of a MessageEvent is unused.
      socket.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>);
    },
    shut(code = 1000, reason = "") {
      // SAFETY: The driver reads a close event's code and reason and nothing else.
      socket.onclose?.({ code, reason } as CloseEvent);
    },
  };
}

/** A synthesizer wired to fakes, with the timers held so a test owns the clock. */
function harness(options: { token?: SpeechTokenAnswer; failMint?: boolean } = {}) {
  const sink = fakeSink();
  const socket = fakeSocket();
  const events: string[] = [];
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  let nextTimer = 1;
  const urls: string[] = [];
  let mints = 0;
  const speech = new ElevenLabsSpeech({
    voiceId: VOICE_ID,
    listener: {
      onAudible: () => events.push("audible"),
      onDrained: () => events.push("drained"),
      onError: (message) => events.push(`error:${message}`),
    },
    sink: sink.sink,
    mintToken: async () => {
      mints += 1;
      if (options.failMint) throw new Error("offline");
      return options.token ?? { outcome: TOKEN_MINT_OUTCOME.OK, token: `single-use-${mints}` };
    },
    createSocket: (url) => {
      urls.push(url);
      return socket.socket;
    },
    schedule: (callback, delayMs) => {
      const id = nextTimer++;
      timers.set(id, { callback, delayMs });
      return id;
    },
    cancelScheduled: (timer) => {
      // SAFETY: Every handle in `timers` was minted by the `schedule` above as a number.
      timers.delete(timer as number);
    },
  });
  return {
    speech,
    sink,
    socket,
    events,
    urls,
    mints: () => mints,
    timers,
    fire(delayMs?: number) {
      for (const [id, timer] of [...timers]) {
        if (delayMs !== undefined && timer.delayMs !== delayMs) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

/** Lets the awaited mint inside `append` settle before the test looks. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("opens one socket per reply and sends the documented frames in order", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  assert.equal(h.mints(), 1);
  assert.equal(h.urls.length, 1);
  assert.match(h.urls[0] ?? "", /single_use_token=single-use-1/);
  // Nothing is sent before the socket opens; the deltas wait in order.
  assert.deepEqual(h.socket.sent, []);

  h.speech.append(" there");
  h.socket.open();
  assert.deepEqual(
    h.socket.sent.map((frame) => JSON.parse(frame)),
    [
      { voices: [VOICE_ID] },
      { inputs: [{ text: "Hello", voice_id: VOICE_ID, new_turn: false }] },
      { inputs: [{ text: " there", voice_id: VOICE_ID, new_turn: false }] },
    ],
  );

  h.speech.append("!");
  assert.deepEqual(JSON.parse(h.socket.sent.at(-1) ?? ""), {
    inputs: [{ text: "!", voice_id: VOICE_ID, new_turn: false }],
  });
  assert.equal(h.speech.finish(), true);
  assert.deepEqual(JSON.parse(h.socket.sent.at(-1) ?? ""), { close_socket: true });
});

test("closes the turn behind the deltas when generation beat the socket open", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hi");
  await settle();
  assert.equal(h.speech.finish(), true);
  h.socket.open();
  assert.deepEqual(
    h.socket.sent.map((frame) => JSON.parse(frame)),
    [
      { voices: [VOICE_ID] },
      { inputs: [{ text: "Hi", voice_id: VOICE_ID, new_turn: false }] },
      { close_socket: true },
    ],
  );
});

test("a reply with no words opens no socket and owes no drain", async () => {
  const h = harness();
  h.speech.start();
  assert.equal(h.speech.finish(), false);
  await settle();
  assert.equal(h.mints(), 0);
  assert.deepEqual(h.urls, []);
  assert.deepEqual(h.events, []);
});

test("plays what arrives, and reports audible once", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.socket.deliver({ audio: AUDIO_FRAME });
  h.socket.deliver({ audio: AUDIO_FRAME });
  assert.deepEqual(h.sink.played, [2, 2]);
  assert.deepEqual(h.events, ["audible"]);
});

test("waits for the scheduled audio to run out before saying the reply drained", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.sink.setPending(120);
  h.socket.deliver({ audio: AUDIO_FRAME, is_final_audio_for_turn: true });
  h.socket.deliver({ is_final: true });
  assert.deepEqual(h.events, ["audible"]);
  // The clock runs out; what is left scheduled is nothing, so the reply ends.
  h.sink.setPending(0);
  h.fire(120);
  assert.deepEqual(h.events, ["audible", "drained"]);
});

test("a socket closing before its last word settles the turn with the failure", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.socket.shut(1008, "invalid_model_id");
  // The service's own reason for closing is what the failure says, so a refused
  // model or voice names itself rather than reading as a lost connection.
  assert.deepEqual(h.events, [
    "error:The speech connection closed before Luke finished speaking: invalid_model_id",
    "drained",
  ]);
});

test("a handshake refused before the socket opened is named by its close code", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  // The socket never opened, so an error fires first; the close behind it is
  // the one that knows anything, and reporting on the error would say less.
  h.socket.socket.onerror?.(new Event("error"));
  assert.deepEqual(h.events, []);
  h.socket.shut(1006, "");
  assert.deepEqual(h.events, [
    "error:The speech connection closed before Luke finished speaking (code 1006).",
    "drained",
  ]);
});

test("a close after the last word is the ordinary ending, not a failure", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.socket.deliver({ is_final: true });
  h.socket.shut();
  assert.deepEqual(h.events, ["drained"]);
});

test("an error frame is said once and settles the turn", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.socket.deliver({ error: "voice not found" });
  h.socket.deliver({ error: "voice not found" });
  assert.deepEqual(h.events, ["error:voice not found", "drained"]);
  // Nothing more is owed, so the turn does not wait on a drain that cannot come.
  assert.equal(h.speech.finish(), false);
});

test("an error frame carrying only its sentence is still a failure", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  // The sentence is the field a reader can act on; an error frame that names
  // its failure only there must not fall through to the socket's silent close.
  h.socket.deliver({ message: "voice_id not found in this account" });
  assert.deepEqual(h.events, ["error:voice_id not found in this account", "drained"]);
});

test("a refused mint reports the service's own sentence and owes nothing", async () => {
  const h = harness({
    token: { outcome: TOKEN_MINT_OUTCOME.UNAUTHORIZED, explanation: "ElevenLabs refused the key." },
  });
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  assert.deepEqual(h.events, ["error:ElevenLabs refused the key.", "drained"]);
  assert.deepEqual(h.urls, []);
  assert.equal(h.speech.finish(), false);
});

test("a mint that threw is a failure like any other", async () => {
  const h = harness({ failMint: true });
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  assert.equal(h.events.length, 2);
  assert.match(h.events[0] ?? "", /^error:/);
  assert.equal(h.events[1], "drained");
});

test("an interruption drops the queue, the socket, and the audio at once", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.socket.deliver({ audio: AUDIO_FRAME });
  h.speech.cancel();
  assert.equal(h.socket.closed(), true);
  assert.equal(h.sink.stops() > 0, true);
  // Everything the old socket still says lands on a generation that has gone.
  h.socket.deliver({ audio: AUDIO_FRAME, is_final: true });
  assert.deepEqual(h.events, ["audible"]);
  assert.deepEqual(h.sink.played, [2]);
});

test("a tool follow-up speaks on a socket and a token of its own", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Looking.");
  await settle();
  h.socket.open();
  assert.equal(h.speech.finish(), true);

  h.speech.start();
  h.speech.append("Done.");
  await settle();
  assert.equal(h.mints(), 2);
  assert.equal(h.urls.length, 2);
  assert.notEqual(h.urls[0], h.urls[1]);
});

test("pings a socket left idle, and stops once the turn is closed", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.socket.sent.length = 0;
  h.fire(ELEVENLABS_KEEP_ALIVE_MS);
  assert.deepEqual(
    h.socket.sent.map((frame) => JSON.parse(frame)),
    [{ keep_alive: true }],
  );

  h.socket.sent.length = 0;
  assert.equal(h.speech.finish(), true);
  h.fire(ELEVENLABS_KEEP_ALIVE_MS);
  assert.deepEqual(
    h.socket.sent.map((frame) => JSON.parse(frame)),
    [{ close_socket: true }],
    "a closed turn is never pinged",
  );
});

test("closing the call releases the audio graph", async () => {
  const h = harness();
  h.speech.start();
  h.speech.append("Hello");
  await settle();
  h.socket.open();
  h.speech.close();
  assert.equal(h.socket.closed(), true);
  assert.equal(h.sink.closes(), 1);
});
