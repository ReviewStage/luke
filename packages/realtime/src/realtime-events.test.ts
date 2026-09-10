import assert from "node:assert/strict";
import test from "node:test";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { PRESS_AUDIO_SAMPLE_RATE } from "./press-audio.js";
import { realtimeSessionConfig } from "./realtime-credentials.js";
import {
  cancelResponseEvents,
  clearInputAudioEvents,
  functionCallFollowUpEvents,
  inputAudioAppendEvents,
  inputAudioFormatUpdateEvents,
  outputSpeedUpdateEvents,
  parseRealtimeServerEvent,
  pushToTalkCommitEvents,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  truncateResponseEvents,
} from "./realtime-events.js";
import { ASK_BRAIN_TOOL, mouthToolDefinitions } from "./realtime-instructions.js";
import { SCENE } from "./voice-scene.js";

test("a refused delete is read back with the event it names", () => {
  // The caller tells its own delete's refusal from a fault meant for the
  // developer by this name, so the wire has to carry it through.
  const parsed = parseRealtimeServerEvent({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "invalid_request_error",
      code: "item_not_found",
      message: "Item with id 'luke_ctx_sessions_1' not found.",
      event_id: "luke_supersede_2",
    },
  });

  assert.equal(parsed?.type, REALTIME_SERVER_EVENT.ERROR);
  assert.equal(parsed?.eventId, "luke_supersede_2");
  assert.equal(parsed?.errorType, "invalid_request_error");
  assert.equal(parsed?.errorCode, "item_not_found");
  assert.match(parsed?.message ?? "", /not found/);
});

test("a reply can be stopped by the developer taking the turn", () => {
  // Cancelling is only half of it. The model generates faster than it speaks,
  // so the rest of the sentence has already been sent by the time anyone talks
  // over it, and only emptying the output buffer stops that being heard.
  const events = cancelResponseEvents({
    cancellationEventId: "response_cancel_1",
    clearEventId: "output_audio_clear_1",
  });
  assert.deepEqual(
    events.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.RESPONSE_CANCEL, REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR],
  );
  assert.equal(events[0]?.event_id, "response_cancel_1");
  assert.equal(events[1]?.event_id, "output_audio_clear_1");
  assert.deepEqual(
    cancelResponseEvents({ cancellationEventId: " ", clearEventId: "output_audio_clear_2" }),
    [],
  );
});

test("a cut-off reply is trimmed to what was heard of it", () => {
  const events = truncateResponseEvents({
    itemId: "item_abc",
    audioEndMs: 1240.7,
    truncationEventId: "item_truncate_1",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE);
  assert.equal(events[0]?.event_id, "item_truncate_1");
  assert.equal(events[0]?.item_id, "item_abc");
  assert.equal(events[0]?.content_index, 0);
  assert.equal(events[0]?.audio_end_ms, 1240);
});

test("nothing heard is nothing to correct", () => {
  // Cut off in the gap before the first word: the model has said nothing to the
  // room, and asking to trim a reply to zero — or trimming a message that was
  // never named — is a request the server refuses rather than a correction. An
  // unnamed trim is refused too: the name is what lets the session recognize
  // the server refusing it as the stop's own answer.
  for (const input of [
    { itemId: "item_abc", audioEndMs: 0, truncationEventId: "item_truncate_1" },
    { itemId: "item_abc", audioEndMs: -50, truncationEventId: "item_truncate_1" },
    { itemId: "item_abc", audioEndMs: Number.NaN, truncationEventId: "item_truncate_1" },
    { itemId: "", audioEndMs: 900, truncationEventId: "item_truncate_1" },
    { itemId: "   ", audioEndMs: 900, truncationEventId: "item_truncate_1" },
    { itemId: "item_abc", audioEndMs: 900, truncationEventId: " " },
  ]) {
    assert.deepEqual(truncateResponseEvents(input), []);
  }
});

test("a captured turn declares its audio's format before appending any", () => {
  // On a WebRTC call nothing else says how base64 audio over the data channel
  // should be read, and the hosted mint composes its session on the service —
  // so the channel itself pins the format, at the capture's own rate.
  assert.deepEqual(inputAudioFormatUpdateEvents(), [
    {
      type: REALTIME_CLIENT_EVENT.SESSION_UPDATE,
      session: {
        type: "realtime",
        audio: { input: { format: { type: "audio/pcm", rate: PRESS_AUDIO_SAMPLE_RATE } } },
      },
    },
  ]);
});

test("the keyed mint pins the same input format the appends travel as", () => {
  const config = realtimeSessionConfig(SCENE.DESKTOP, mouthToolDefinitions());

  assert.deepEqual(config.audio.input.format, {
    type: "audio/pcm",
    rate: PRESS_AUDIO_SAMPLE_RATE,
  });
});

test("captured audio travels as one append, little-endian PCM in base64", () => {
  const events = inputAudioAppendEvents(new Int16Array([0, 1, -1, 32_767, -32_768]));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND);
  // The five samples byte for byte, as Node's own encoder writes them —
  // including the padded tail a length that is not a multiple of three needs.
  assert.equal(events[0]?.audio, "AAABAP///38AgA==");
});

test("the append encoder agrees with a reference encoder at every length", () => {
  // Base64 groups three bytes at a time, so each length modulo three is its
  // own code path; a hand-rolled encoder has to be held to all of them.
  for (const length of [1, 2, 3, 4, 5, 6, 100]) {
    const samples = new Int16Array(length);
    for (let index = 0; index < length; index += 1) samples[index] = index * 257 - 30_000;
    const bytes = Buffer.alloc(length * 2);
    for (let index = 0; index < length; index += 1) {
      bytes.writeInt16LE(samples[index] ?? 0, index * 2);
    }
    assert.equal(inputAudioAppendEvents(samples)[0]?.audio, bytes.toString("base64"));
  }
});

test("an empty chunk builds no append rather than one the API refuses", () => {
  assert.deepEqual(inputAudioAppendEvents(new Int16Array(0)), []);
});

test("push-to-talk commits a turn and cancelling discards it", () => {
  assert.deepEqual(
    pushToTalkCommitEvents().map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  assert.deepEqual(
    clearInputAudioEvents().map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR],
  );
});

test("a changed pace reaches the live session as a session update", () => {
  const events = outputSpeedUpdateEvents(1.25);

  assert.deepEqual(events, [
    {
      type: REALTIME_CLIENT_EVENT.SESSION_UPDATE,
      session: { type: "realtime", audio: { output: { speed: 1.25 } } },
    },
  ]);
});

test("an unusable pace builds no update rather than one the API refuses", () => {
  for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(outputSpeedUpdateEvents(speed), []);
  }
});

test("tool calls are read whole from a finished response", () => {
  const event = parseRealtimeServerEvent({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
      output: [
        { type: "message", id: "item-1" },
        {
          type: "function_call",
          name: ASK_BRAIN_TOOL.name,
          call_id: "call-1",
          arguments: '{"question":"what needs me?"}',
        },
        { type: "function_call", name: "", call_id: "call-2", arguments: "{}" },
      ],
    },
  });

  assert.deepEqual(event, {
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    responseId: "resp-1",
    calls: [
      {
        name: ASK_BRAIN_TOOL.name,
        callId: "call-1",
        argumentsJson: '{"question":"what needs me?"}',
      },
    ],
    hasAudio: false,
  });
});

test("a finished response says whether it made any sound", () => {
  // Audio in the output: the reply has speech to play out.
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
      response: {
        id: "resp-1",
        output: [
          { type: "message", id: "item-1", content: [{ type: "output_audio", transcript: "Hi" }] },
        ],
      },
    }),
    { type: REALTIME_SERVER_EVENT.RESPONSE_DONE, responseId: "resp-1", calls: [], hasAudio: true },
  );
  // Output with no audio in it: a reply of pure silence.
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
      response: { id: "resp-1", output: [] },
    }),
    { type: REALTIME_SERVER_EVENT.RESPONSE_DONE, responseId: "resp-1", calls: [], hasAudio: false },
  );
  // No output to read: unknown, which must not pass for silent — the bare
  // event below stays exactly as it always parsed.
});

test("inbound events the conversation acts on are parsed, and nothing else is", () => {
  assert.deepEqual(parseRealtimeServerEvent({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED }), {
    type: REALTIME_SERVER_EVENT.RESPONSE_CREATED,
  });
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.RESPONSE_CREATED,
      response: { id: "resp-1" },
    }),
    { type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, responseId: "resp-1" },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
      item: { id: "item-1" },
    }),
    { type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, itemId: "item-1" },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      item_id: "item-1",
      delta: "Hello",
    }),
    {
      type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
      itemId: "item-1",
      delta: "Hello",
    },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
      item_id: "item-1",
      transcript: "Hello there.",
    }),
    {
      type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
      itemId: "item-1",
      transcript: "Hello there.",
    },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED }),
    { type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED,
      response_id: "resp-1",
    }),
    { type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED, responseId: "resp-1" },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED }),
    { type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED,
      response_id: "resp-1",
    }),
    { type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED, responseId: "resp-1" },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
      item_id: "item-2",
      transcript: "how is the checkout agent doing?",
    }),
    {
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
      itemId: "item-2",
      transcript: "how is the checkout agent doing?",
    },
  );
  // A transcription that came back empty still ends its turn, so the preview
  // its deltas built can leave; the empty words record nothing downstream.
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
      item_id: "item-2",
      transcript: "  ",
    }),
    {
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
      itemId: "item-2",
      transcript: "",
    },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA,
      item_id: "item-2",
      delta: "how is the",
    }),
    {
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA,
      itemId: "item-2",
      delta: "how is the",
    },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_FAILED,
      item_id: "item-2",
    }),
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_FAILED, itemId: "item-2" },
  );
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.INPUT_AUDIO_BUFFER_COMMITTED,
      item_id: "item-2",
    }),
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_BUFFER_COMMITTED, itemId: "item-2" },
  );
  assert.deepEqual(parseRealtimeServerEvent({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE }), {
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    calls: [],
  });
  assert.deepEqual(
    parseRealtimeServerEvent({
      type: REALTIME_SERVER_EVENT.ERROR,
      error: { message: "Session expired" },
    }),
    { type: REALTIME_SERVER_EVENT.ERROR, message: "Session expired" },
  );
  assert.deepEqual(parseRealtimeServerEvent({ type: REALTIME_SERVER_EVENT.ERROR }), {
    type: REALTIME_SERVER_EVENT.ERROR,
    message: "The voice service reported an error.",
  });

  // The data channel delivers a JSON string; the parser owns that too, so the
  // renderer never has to know the wire encoding.
  assert.deepEqual(
    parseRealtimeServerEvent(
      JSON.stringify({
        type: REALTIME_SERVER_EVENT.RESPONSE_CREATED,
        response: { id: "resp-2" },
      }),
    ),
    { type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, responseId: "resp-2" },
  );

  const payloads: UnparsedWireValue[] = [
    undefined,
    null,
    3,
    "not json {",
    "not an object",
    [],
    {},
    { type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_CLEARED },
    { type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA, item_id: "item-1" },
    // A transcription without its turn's item names nothing to act on.
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED, transcript: "  " },
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED, transcript: "hello" },
    // A preview without its turn, or without words, previews nothing.
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA, delta: "hello" },
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA, item_id: "item-2", delta: "" },
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_FAILED },
    { type: REALTIME_SERVER_EVENT.INPUT_AUDIO_BUFFER_COMMITTED },
    { type: "session.updated" },
  ];
  for (const payload of payloads) {
    assert.equal(parseRealtimeServerEvent(payload), undefined);
  }
});

test("the reply that voices an outcome cannot itself call a tool", () => {
  const [request] = functionCallFollowUpEvents();

  assert.equal(request?.type, REALTIME_CLIENT_EVENT.RESPONSE_CREATE);
  const response = request?.response;
  assert.ok(isRecord(response));
  // The follow-up is opened to say what happened, not to act again — a tool
  // output that reads like an instruction has nothing to act with. It also
  // inherits the session's standing instructions rather than replacing them.
  assert.equal(response.tool_choice, "none");
  assert.deepEqual(response.tools, []);
  assert.equal(response.instructions, undefined);
});
