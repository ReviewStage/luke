import assert from "node:assert/strict";
import test from "node:test";
import { TRACE_DIRECTION, type TraceDirection } from "@sidecar/devtrace/vocabulary";
import {
  ARRIVAL_SPEECH_KIND,
  ASK_BRAIN_TOOL,
  BRIEFING_SPEECH_KIND,
  type BriefingSpeech,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  inputAudioAppendEvents,
  inputAudioFormatUpdateEvents,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeConnection,
  type RealtimeStatus,
} from "@sidecar/realtime";
import { ACT_RESULT_STATUS, isRecord, text, type WireRecord } from "@sidecar/wire";
import type { JsonValue, ParsedJsonObject } from "@sidecar/wire/testing";
import type { BrainAskResult } from "#shared/wire/brain";
import {
  asMediaStream,
  asMediaTrack,
  asPeerConnection,
  type MockMediaStream,
  type MockMediaTrack,
  type MockPeerConnection,
  type MockRtpSender,
  type MockTrackEvent,
} from "#testing/realtime-fixtures";
import type { SdkRealtimeTransport, SdkTransportFactoryOptions } from "./agents-realtime-transport";
import { BriefingQueue } from "./briefing-queue";
import {
  BRAIN_ASK_SETTLE_TIMEOUT_MS,
  quietIsLukesOwn,
  REALTIME_SETTLE_TIMEOUT_MS,
  REMOTE_QUIET_MS,
  REPLY_KIND,
  RealtimeVoiceSession,
  type ReplyKind,
} from "./realtime-session";

function sessionField(event: ParsedJsonObject | undefined): ParsedJsonObject | undefined {
  if (!event) return undefined;
  const session = event.session;
  return isRecord(session) ? session : undefined;
}

function sessionAudioField(event: ParsedJsonObject | undefined): JsonValue | undefined {
  return sessionField(event)?.audio;
}

const CONNECTION: RealtimeConnection = {
  value: "ek_test_secret",
  expiresAt: 1_800_000_060_000,
  model: "gpt-realtime-2.1",
  callsUrl: "https://api.openai.com/v1/realtime/calls",
};

interface ReplyEnding {
  texts: readonly string[];
  about: readonly string[] | undefined;
  kind: ReplyKind | undefined;
}

interface Harness {
  session: RealtimeVoiceSession;
  sent: ParsedJsonObject[];
  errors: (string | undefined)[];
  /** Each caption emission: one text per stacked response, or a clear. */
  captions: (readonly string[] | undefined)[];
  /** The sessions each caption emission was about, by session id. */
  captionSubjects: (readonly string[] | undefined)[];
  /** The words each ended reply left behind, with its subject and its kind. */
  replyEndings: ReplyEnding[];
  /** The questions the voice asked the brain, in order. */
  asked: string[];
  /** The developer's spoken turns, as the service handed them back. */
  spokenAsks: string[];
  /** The growing pieces of those turns' words, in arrival order. */
  spokenAskDeltas: { itemId: string; delta: string }[];
  /** The turns whose transcription the service gave up on. */
  spokenAskFailures: string[];
  /** Conversation items fixed for those turns before their transcripts returned. */
  spokenAskItems: string[];
  /** Number of local audio turns closed before the server acknowledged them. */
  spokenAskClosures: () => number;
  microphoneEnabled: () => boolean;
  microphoneStopped: () => boolean;
  emit: (event: JsonValue) => void;
  emitRaw: (data: JsonValue) => void;
  executeSdkTool: SdkTransportFactoryOptions["executeTool"];
  lukeAudible: () => boolean;
  deliverRemoteTrack: (streams?: readonly object[]) => void;
  provideConnection: () => void;
  setConnectionState: (state: RTCPeerConnectionState) => void;
  failStalePeer: () => void;
  closeChannel: () => void;
  requests: { apiKey: string; model: string; url: string }[];
  /** The order the credential and the device were asked for and answered in. */
  calls: string[];
  /** The stable synthetic track the SDK sender carries between presses. */
  silenceTrack: MockMediaTrack;
  /** Every track handed to the sender, `null` standing for the device let go. */
  replacedTracks: () => (object | null)[];
  /**
   * The press captures the session created, in order. `feed` plays samples
   * into one as the audio graph would; `stopped` says the session let go.
   */
  pressCaptures: { stopped: boolean; feed: (samples: readonly number[]) => void }[];
  /** Makes the next device request refuse, as a vanished microphone would. */
  failMicrophone: () => void;
  /** Holds device opens in flight until `ungateMicrophone` lets them land. */
  gateMicrophone: () => void;
  ungateMicrophone: () => void;
}

/** An answer the brain accepted: words to say, about the sessions named. */
function brainAnswer(briefing: string, ...sessionIds: readonly string[]): BrainAskResult {
  return {
    status: ACT_RESULT_STATUS.ACCEPTED,
    briefing,
    sessionIds: sessionIds.map((id) => ({ providerId: "claude-code", providerSessionId: id })),
  };
}

function harness(
  options: {
    connection?: RealtimeConnection | undefined;
    sdpResponse?: Response;
    microphoneError?: Error;
    channelOpensImmediately?: boolean;
    connectTimeoutMs?: number;
    sdpDelayMs?: number;
    connectionDelayMs?: number;
    connectionError?: Error;
    now?: () => number;
    /**
     * Answers the voice's one tool. Absent by default, as a call with no brain
     * behind it is; a test that wants the ask answered supplies the brain.
     */
    askBrain?: (question: string) => Promise<BrainAskResult>;
    sdkCloseError?: Error;
    /** Lets a test ride the status edges, the way the briefing queue does. */
    onStatus?: (status: RealtimeStatus) => void;
    /** Lets a test stand where the development trace's tap does. */
    onWireEvent?: (direction: TraceDirection, event: WireRecord) => void;
    /** Lets a test see what the element would be handed to play. */
    onRemoteStream?: (stream: MediaStream | undefined) => void;
  } = {},
): Harness {
  const sent: ParsedJsonObject[] = [];
  const errors: (string | undefined)[] = [];
  const captions: (readonly string[] | undefined)[] = [];
  const captionSubjects: (readonly string[] | undefined)[] = [];
  const replyEndings: ReplyEnding[] = [];
  const asked: string[] = [];
  const spokenAsks: string[] = [];
  const spokenAskDeltas: { itemId: string; delta: string }[] = [];
  const spokenAskFailures: string[] = [];
  const spokenAskItems: string[] = [];
  let spokenAskClosures = 0;
  const requests: { apiKey: string; model: string; url: string }[] = [];
  const calls: string[] = [];
  let enabled = false;
  let stopped = false;

  const track = {
    get enabled() {
      return enabled;
    },
    set enabled(value: boolean) {
      enabled = value;
    },
    stop: () => {
      stopped = true;
    },
  };
  const stream: MockMediaStream = { getAudioTracks: () => [track], getTracks: () => [track] };

  const remoteTrack = { enabled: true };
  const replacedTracks: (MockMediaTrack | null)[] = [];
  const silenceTrack: MockMediaTrack = { kind: "audio" };
  const connectionStateListeners = new Set<() => void>();
  const staleConnectionStateListeners = new Set<() => void>();
  const sender: MockRtpSender = {
    track: silenceTrack,
    replaceTrack: async (next: MockMediaTrack | null) => {
      sender.track = next;
      replacedTracks.push(next);
    },
  };
  const peer: MockPeerConnection = {
    connectionState: "connected",
    getSenders: () => [sender],
    addEventListener: (_type, listener) => connectionStateListeners.add(listener),
  };
  let sdkOptions: SdkTransportFactoryOptions | undefined;
  let sdkStatus: SdkRealtimeTransport["status"] = "disconnected";
  let sdkCloseError = options.sdkCloseError;
  const dispatchedCalls = new Set<string>();
  let syntheticResponseSequence = 0;

  const recordClientEvent = (event: WireRecord): void => {
    const parsed: ParsedJsonObject = JSON.parse(JSON.stringify(event));
    sent.push(parsed);
    sdkOptions?.onClientEvent(event);
  };
  const dispatchToolCall = (call: ParsedJsonObject): void => {
    const callId = text(call.call_id);
    const name = text(call.name);
    const argumentsJson = text(call.arguments);
    if (!callId || !name || argumentsJson === undefined || dispatchedCalls.has(callId)) return;
    dispatchedCalls.add(callId);
    void sdkOptions
      ?.executeTool(name, {
        toolCall: { type: "function_call", callId, name, arguments: argumentsJson },
      })
      .then((output) => {
        recordClientEvent({
          type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
          item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
        });
        sdkOptions?.onToolOutputSent(callId);
      });
  };
  const emitServerEvent = (data: JsonValue): void => {
    const wireData = JSON.parse(JSON.stringify(data));
    if (!isRecord(wireData)) {
      sdkOptions?.onTransportEvent(wireData);
      return;
    }
    let event = wireData;
    if (event.type === REALTIME_SERVER_EVENT.RESPONSE_DONE && isRecord(event.response)) {
      const calls = Array.isArray(event.response.output)
        ? event.response.output.filter(isRecord).filter((item) => item.type === "function_call")
        : [];
      if (calls.length > 0 && text(event.response.id) === undefined) {
        const responseId = `response-${++syntheticResponseSequence}`;
        sdkOptions?.onTransportEvent({
          type: REALTIME_SERVER_EVENT.RESPONSE_CREATED,
          response: { id: responseId },
        });
        event = { ...event, response: { ...event.response, id: responseId } };
      }
      sdkOptions?.onTransportEvent(JSON.parse(JSON.stringify(event)));
      for (const call of calls) dispatchToolCall(call);
      return;
    }
    sdkOptions?.onTransportEvent(JSON.parse(JSON.stringify(event)));
    if (event.type === "response.output_item.done" && isRecord(event.item)) {
      dispatchToolCall(event.item);
    }
  };

  const createSdkTransport = (
    transportOptions: SdkTransportFactoryOptions,
  ): SdkRealtimeTransport => {
    sdkOptions = transportOptions;
    sender.track = silenceTrack;
    peer.connectionState = "connected";
    let closed = false;
    return {
      get status() {
        return sdkStatus;
      },
      connect: async (request) => {
        sdkStatus = "connecting";
        requests.push(request);
        for (const listener of connectionStateListeners)
          staleConnectionStateListeners.add(listener);
        connectionStateListeners.clear();
        transportOptions.onPeerConnection(asPeerConnection(peer), asMediaTrack(silenceTrack));
        if (options.sdpDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.sdpDelayMs));
        }
        const response = options.sdpResponse;
        if (response && !response.ok)
          throw new Error(`Realtime call failed with status ${response.status}.`);
        if (options.channelOpensImmediately === false) {
          await new Promise<void>(() => undefined);
        }
        if (closed) throw new Error("The voice connection closed while opening.");
        sdkStatus = "connected";
        transportOptions.onConnectionChange(sdkStatus);
      },
      sendEvent: recordClientEvent,
      sendMessage: (message) => {
        recordClientEvent({
          type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
          item: { type: "message", role: "user", content: [{ type: "input_text", text: message }] },
        });
        recordClientEvent({ type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE });
      },
      close: () => {
        if (closed) return;
        closed = true;
        sdkStatus = "disconnected";
        transportOptions.onConnectionChange(sdkStatus);
        if (sdkCloseError) {
          const error = sdkCloseError;
          sdkCloseError = undefined;
          throw error;
        }
      },
    };
  };

  let connection = "connection" in options ? options.connection : CONNECTION;
  let microphoneError = options.microphoneError;
  let microphoneGate: (() => void)[] | undefined;
  const pressCaptures: { stopped: boolean; feed: (samples: readonly number[]) => void }[] = [];
  const sessionOptions: ConstructorParameters<typeof RealtimeVoiceSession>[0] = {
    requestConnection: async () => {
      calls.push("credential-requested");
      if (options.connectionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.connectionDelayMs));
      }
      if (options.connectionError) throw options.connectionError;
      calls.push("credential-resolved");
      return connection;
    },
    requestMicrophoneStream: async () => {
      calls.push("microphone-requested");
      if (microphoneError) throw microphoneError;
      if (microphoneGate) {
        await new Promise<void>((resolve) => {
          microphoneGate?.push(resolve);
        });
      }
      return asMediaStream(stream);
    },
    createPressCapture: (_stream, onChunk) => {
      const record = {
        stopped: false,
        feed: (samples: readonly number[]) => onChunk(new Int16Array(samples)),
      };
      pressCaptures.push(record);
      return {
        stop: () => {
          record.stopped = true;
        },
      };
    },
    createSdkTransport,
    onStatus: (status) => options.onStatus?.(status),
    onLocalStream: () => undefined,
    onRemoteStream: (stream) => options.onRemoteStream?.(stream),
    onError: (message) => errors.push(message),
    onCaption: (texts, about) => {
      captions.push(texts);
      captionSubjects.push(about?.map(({ providerSessionId }) => providerSessionId));
    },
    onReplyEnded: (texts, about, kind) => {
      replyEndings.push({
        texts,
        about: about?.map(({ providerSessionId }) => providerSessionId),
        kind,
      });
    },
    onSpokenAsk: (transcript) => {
      spokenAsks.push(transcript);
    },
    onSpokenAskDelta: (itemId, delta) => {
      spokenAskDeltas.push({ itemId, delta });
    },
    onSpokenAskFailed: (itemId) => {
      spokenAskFailures.push(itemId);
    },
    onSpokenAskClosed: () => {
      spokenAskClosures += 1;
    },
    onSpokenAskCommitted: (itemId) => spokenAskItems.push(itemId),
  };
  if (options.connectTimeoutMs !== undefined) {
    sessionOptions.connectTimeoutMs = options.connectTimeoutMs;
  }
  if (options.onWireEvent) {
    sessionOptions.onWireEvent = options.onWireEvent;
  }
  if (options.now) {
    sessionOptions.now = options.now;
  }
  const askBrain = options.askBrain;
  if (askBrain) {
    sessionOptions.askBrain = (question) => {
      asked.push(question);
      return askBrain(question);
    };
  }
  const session = new RealtimeVoiceSession(sessionOptions);

  return {
    session,
    sent,
    errors,
    captions,
    captionSubjects,
    replyEndings,
    asked,
    spokenAsks,
    spokenAskDeltas,
    spokenAskFailures,
    spokenAskItems,
    spokenAskClosures: () => spokenAskClosures,
    microphoneEnabled: () => enabled,
    microphoneStopped: () => stopped,
    lukeAudible: () => remoteTrack.enabled,
    provideConnection: () => {
      connection = CONNECTION;
    },
    deliverRemoteTrack: (streams = [{}]) => {
      const trackEvent: MockTrackEvent = {
        track: remoteTrack,
        streams,
      };
      peer.ontrack?.(trackEvent);
    },
    emit: (event) => {
      emitServerEvent(event);
    },
    emitRaw: (data) => {
      sdkOptions?.onTransportEvent(JSON.parse(JSON.stringify(data)));
    },
    executeSdkTool: async (name, details) => {
      if (!sdkOptions) throw new Error("The SDK transport is not connected.");
      return sdkOptions.executeTool(name, details);
    },
    setConnectionState: (state) => {
      peer.connectionState = state;
      for (const listener of connectionStateListeners) listener();
    },
    failStalePeer: () => {
      peer.connectionState = "failed";
      for (const listener of staleConnectionStateListeners) listener();
    },
    closeChannel: () => {
      sdkStatus = "disconnected";
      sdkOptions?.onConnectionChange(sdkStatus);
    },
    requests,
    calls,
    replacedTracks: () => replacedTracks,
    failMicrophone: () => {
      microphoneError = new Error("The microphone went away");
    },
    gateMicrophone: () => {
      microphoneGate = [];
    },
    ungateMicrophone: () => {
      const held = microphoneGate ?? [];
      microphoneGate = undefined;
      for (const release of held) release();
    },
    silenceTrack,
    pressCaptures,
  };
}

/** Lets the device a press asked for arrive: one macrotask drains the open. */
function deviceArrives(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Presses the talk key and waits for the device it opens. The microphone is
 * the developer's, not the call's, so every turn starts with this ask.
 */
async function holdTurn(context: Harness): Promise<void> {
  context.session.beginTurn();
  await deviceArrives();
}

/** Opens and commits a developer turn, the turn a spoken ask of the brain arrives in. */
async function armDeveloperTurn(context: Harness): Promise<void> {
  await holdTurn(context);
  context.session.stopListening(true);
}

/** Ends the reply the server was producing, settling the exchange to READY. */
function settleReply(context: Harness): void {
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
}

/** One briefing the brain decided about one session, decided a moment ago. */
function briefingAbout(id: string, briefing = `Claude Code finished ${id}.`): BriefingSpeech {
  return {
    kind: BRIEFING_SPEECH_KIND,
    briefing,
    sessionIds: [{ providerId: "claude-code", providerSessionId: id }],
    decidedAt: Date.now(),
  };
}

/** One `ask_brain` call as it sits inside a finished response's output. */
function askBrainCall(question: string, callId = "call-1"): JsonValue {
  return {
    type: "function_call",
    name: ASK_BRAIN_TOOL.name,
    call_id: callId,
    arguments: JSON.stringify({ question }),
  };
}

/** A `response.done` whose one output is an `ask_brain` call carrying the developer's words. */
function askBrainDone(
  question: string,
  options: { callId?: string; responseId?: string } = {},
): JsonValue {
  const output = [askBrainCall(question, options.callId)];
  const response =
    options.responseId === undefined ? { output } : { id: options.responseId, output };
  return { type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response };
}

/** The tool outputs sent since `from`, each parsed back out of its item. */
function toolOutputs(context: Harness, from = 0): ParsedJsonObject[] {
  return context.sent.slice(from).flatMap((event) => {
    const item = isRecord(event.item) ? event.item : undefined;
    if (item?.type !== "function_call_output") return [];
    const output = text(item.output);
    if (output === undefined) return [];
    const parsed: ParsedJsonObject = JSON.parse(output);
    return [parsed];
  });
}

/** The reply requests sent since `from`. */
function responseCreates(context: Harness, from = 0): ParsedJsonObject[] {
  return context.sent
    .slice(from)
    .filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE);
}

/** The errors actually shown, past the clearing every connect starts with. */
function reportedErrors(context: Harness): string[] {
  return context.errors.filter((message): message is string => message !== undefined);
}

test("connecting opens the call and leaves the microphone closed", async () => {
  const context = harness();

  assert.equal(await context.session.connect(), true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Connected is not the same as listening: the device is the developer's,
  // not the call's, so connecting asks for no microphone at all.
  assert.equal(context.microphoneEnabled(), false);
  assert.ok(!context.calls.includes("microphone-requested"));

  const request = context.requests[0];
  assert.equal(request?.url, CONNECTION.callsUrl);
  assert.equal(request?.apiKey, CONNECTION.value);
  assert.equal(request?.model, CONNECTION.model);
});

test("the wire tap sees both directions, raw, before the parser narrows or drops", async () => {
  const tapped: { direction: TraceDirection; event: WireRecord }[] = [];
  const context = harness({
    onWireEvent: (direction, event) => tapped.push({ direction, event }),
  });
  await context.session.connect();
  context.session.applySpeed(1.25);

  // A live config change crosses the tap as the raw event the call sends.
  const clientTypes = tapped
    .filter((entry) => entry.direction === TRACE_DIRECTION.CLIENT)
    .map((entry) => entry.event.type);
  assert.ok(clientTypes.includes(REALTIME_CLIENT_EVENT.SESSION_UPDATE));

  // A reply's `done` reaches the tap with the fields the parser discards, and
  // an event type this build does not act on reaches it at all.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: { id: "resp_1", usage: { input_tokens: 12 } },
  });
  context.emit({ type: "rate_limits.updated", rate_limits: [] });
  const server = tapped.filter((entry) => entry.direction === TRACE_DIRECTION.SERVER);
  const done = server.find((entry) => entry.event.type === REALTIME_SERVER_EVENT.RESPONSE_DONE);
  assert.ok(isRecord(done?.event.response));
  assert.deepEqual(done?.event.response.usage, { input_tokens: 12 });
  assert.ok(server.some((entry) => entry.event.type === "rate_limits.updated"));
});

test("no credential leaves the voice experience explicitly unavailable", async () => {
  const context = harness({ connection: undefined });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.UNAVAILABLE);
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
  // No device was opened for a call that never came: there is nothing held
  // and nothing to let go of.
  assert.ok(!context.calls.includes("microphone-requested"));
});

test("the press asks for the device; the connect asks only for the credential", async () => {
  // The microphone is user-driven: opening a call — for a typed ask, say —
  // must not touch the device. Only the press that takes a turn opens it.
  const context = harness({ connectionDelayMs: 20 });

  assert.equal(await context.session.connect(), true);
  assert.deepEqual(context.calls, ["credential-requested", "credential-resolved"]);

  await holdTurn(context);
  assert.deepEqual(context.calls.at(-1), "microphone-requested");
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a refused call fails without leaking the ephemeral secret", async () => {
  const context = harness({ sdpResponse: new Response("nope", { status: 403 }) });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  const reported = context.errors.filter((message) => message !== undefined).join(" ");
  assert.match(reported, /403/);
  assert.ok(!reported.includes(CONNECTION.value));
});

test("a denied microphone fails the call at the press, not before", async () => {
  const context = harness({ microphoneError: new Error("Permission denied") });

  // The call itself opens fine: no device is asked for until a turn is.
  assert.equal(await context.session.connect(), true);

  await holdTurn(context);

  // The press found the device refused, and a call that cannot listen is
  // failed rather than left looking able to.
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  assert.equal(context.session.turnPending, false);
  assert.ok(context.errors.includes("Permission denied"));
});

test("push-to-talk opens the microphone only while held, then asks for a reply", async () => {
  const context = harness();
  await context.session.connect();

  await holdTurn(context);
  assert.equal(context.microphoneEnabled(), true);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  context.session.stopListening(true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  // The device is not closed at the commit — closing it is audible on shared
  // hardware, and Luke is just starting to answer — but the track is off, so
  // nothing is sent while he speaks.
  assert.equal(context.microphoneStopped(), false);

  settleReply(context);

  // The exchange settling is what closes it, in the quiet after the reply.
  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.replacedTracks().at(-1), context.silenceTrack);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
});

test("an abandoned turn clears the buffer instead of answering it", async () => {
  const context = harness();
  await context.session.connect();

  await holdTurn(context);
  context.session.stopListening(false);

  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // One clear opens the turn, one abandons it.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
    ],
  );
});

test("push-to-talk does nothing before the call is open", () => {
  const context = harness();

  context.session.startListening();

  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
});

test("a briefing is spoken once the call is open", async () => {
  const context = harness();
  const speech = briefingAbout("session-a", "The checkout service needs a decision.");

  // Nothing is spoken before there is a call to speak over.
  assert.equal(context.session.speak(speech), false);

  await context.session.connect();
  assert.equal(context.session.speak(speech), true);
  // The briefing travels inside one isolated response request, so it can read
  // neither the developer's conversation nor another briefing, and no tool
  // may answer it.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  const response = context.sent[0]?.response;
  assert.ok(isRecord(response));
  assert.equal(response.conversation, "none");
  assert.deepEqual(response.tools, []);
  assert.equal(response.tool_choice, "none");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a held turn lasts exactly as long as the key is down", async () => {
  const context = harness();
  await context.session.connect();

  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);

  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.microphoneEnabled(), false);
  assert.ok(
    context.sent.some((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT),
  );
});

test("a turn let go of before the call opened is dropped, not sent", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  // The microphone opens for the press's turn, and neither the call nor the
  // device was up yet: the key was held over nothing. Committing it would ask
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // the server to answer an empty buffer, which comes back as an error.
  context.session.endTurn(true);
  await opening;

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT),
    [],
  );
});

test("holding the key through a reply takes the turn back", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  await holdTurn(context);

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.lukeAudible(), false);
});

test("a remote track arriving with no stream is wrapped rather than dropped", async () => {
  const received: (MediaStream | undefined)[] = [];
  const context = harness({ onRemoteStream: (stream) => received.push(stream) });
  // Node has no MediaStream; the fallback under test is the one constructor.
  // SAFETY: The global is widened only to hold the stub for this test's scope.
  const globals = globalThis as { MediaStream?: unknown };
  const previous = globals.MediaStream;
  class StubMediaStream {
    readonly tracks: readonly object[];
    constructor(tracks: readonly object[]) {
      this.tracks = tracks;
    }
  }
  globals.MediaStream = StubMediaStream;
  try {
    await context.session.connect({ microphone: false });
    context.deliverRemoteTrack([]);
  } finally {
    globals.MediaStream = previous;
  }

  const [stream] = received;
  assert.ok(stream instanceof StubMediaStream);
});

test("a press during the handshake opens the turn it was asking for", async () => {
  const context = harness({ connectionDelayMs: 5 });

  // The order a talk key produces: the press comes first, and the call is what
  // it starts. The press opens the device beside the mint and is captured
  // from the moment it answers, so the turn opens on those words — as
  // appends, with the track joining the sender only when the turn is over.
  context.session.toggleTurn();
  await context.session.connect();

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Open for the capture to read — a disabled track reads as silence — while
  // the sender stays empty, so nothing rides the network before the commit.
  assert.equal(context.microphoneEnabled(), true);
  assert.deepEqual(context.replacedTracks(), []);
});

test("pressing twice during the handshake leaves no turn open", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.toggleTurn();
  const opening = context.session.connect();
  // Pressing again before the call is up cannot send anything — the microphone
  // has not opened yet — so it takes back the press rather than queueing a turn
  // that would commit an empty buffer.
  context.session.toggleTurn();
  await opening;

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT),
    [],
  );
});

test("words spoken into the handshake are carried into the turn it opens", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  // The press asked for the device before the mint was even requested — the
  // press is what opens it — and it answered while the mint was still out:
  // the press's words are already being captured.
  await deviceArrives();
  assert.deepEqual(context.calls.slice(0, 2), ["microphone-requested", "credential-requested"]);
  const capture = context.pressCaptures[0];
  assert.ok(capture);
  assert.equal(context.microphoneEnabled(), true);
  capture.feed([1, 2, 3]);
  capture.feed([4, 5]);
  assert.equal(await opening, true);

  // The turn opened on what was held: the format the appends must be read
  // as, a clean buffer, then the captured chunks in capture order, all on
  // the one ordered channel.
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.deepEqual(context.sent, [
    ...inputAudioFormatUpdateEvents(),
    { type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR },
    ...inputAudioAppendEvents(new Int16Array([1, 2, 3])),
    ...inputAudioAppendEvents(new Int16Array([4, 5])),
  ]);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The whole turn travels as appends, so the sender carries no track yet:
  // its silence must not land beside the words.
  assert.deepEqual(context.replacedTracks(), []);

  // Words said after the channel opened ride the same path, live.
  capture.feed([6]);
  assert.deepEqual(context.sent.at(-1), inputAudioAppendEvents(new Int16Array([6]))[0]);

  // The release commits behind the last append: nothing can double or drop,
  // because one channel carried every word and the commit follows them all.
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.deepEqual(
    context.sent.slice(-2).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  // The seam settles with the turn: the capture ends, the track closes with
  // it, and the sender takes the track for every turn after this one.
  assert.equal(capture.stopped, true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.replacedTracks().length, 1);
  assert.notEqual(context.replacedTracks().at(-1), null);
});

test("a release during the handshake delivers the words once the channel opens", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  const capture = context.pressCaptures[0];
  assert.ok(capture);
  capture.feed([7, 8]);
  // The key comes up while the call is still connecting: the capture stops
  // reading and the device closes this instant — the sealed words wait in
  // memory, not on an open microphone.
  context.session.endTurn(true);
  assert.equal(capture.stopped, true);
  assert.equal(context.microphoneStopped(), true);
  // The press is still owed its turn, so the opening meter keeps riding.
  assert.equal(context.session.turnPending, true);

  assert.equal(await opening, true);
  // The delivery waits a beat after the channel opens rather than landing
  // inside the connect that resolved.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  await deviceArrives();

  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.spokenAskClosures(), 1);
  assert.equal(context.session.turnPending, false);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.SESSION_UPDATE,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  assert.deepEqual(context.sent[0], inputAudioFormatUpdateEvents()[0]);
  assert.deepEqual(context.sent[2], inputAudioAppendEvents(new Int16Array([7, 8]))[0]);
});

test("the words a failed attempt captured die with it", async () => {
  const context = harness({ connection: undefined, connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([9, 9]);
  context.session.endTurn(true);
  assert.equal(await opening, false);

  assert.equal(context.session.status, REALTIME_STATUS.UNAVAILABLE);
  assert.equal(context.pressCaptures[0]?.stopped, true);
  assert.equal(context.session.turnPending, false);

  // The key appears later and something opens a call. Nobody has pressed
  // anything since, so nothing of those words may reach it: a press does not
  // outlive the attempt it started, and now neither does what it said.
  context.provideConnection();
  assert.equal(await context.session.connect(), true);
  await deviceArrives();
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.deepEqual(
    context.sent.filter(
      (event) =>
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND ||
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
    ),
    [],
  );
});

test("pressing twice during the handshake takes the words back with the press", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.toggleTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([1]);
  context.session.toggleTurn();
  // The cancelled turn takes its words and its device with it.
  assert.equal(context.pressCaptures[0]?.stopped, true);
  assert.equal(context.microphoneStopped(), true);
  await opening;

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.deepEqual(
    context.sent.filter(
      (event) =>
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND ||
        event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
    ),
    [],
  );
});

test("an abandoned captured turn clears the buffer and settles the seam", async () => {
  const context = harness({ connectionDelayMs: 5 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  const capture = context.pressCaptures[0];
  assert.ok(capture);
  capture.feed([1, 2]);
  await opening;
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  context.session.endTurn(false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(capture.stopped, true);
  const types = context.sent.map((event) => event.type);
  // One clear opened the turn, one abandoned it, and nothing was committed.
  assert.equal(
    types.filter((type) => type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR).length,
    2,
  );
  assert.equal(types.includes(REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT), false);

  // A chunk from the capture the session already let go of goes nowhere.
  const sentBefore = context.sent.length;
  capture.feed([5]);
  assert.equal(context.sent.length, sentBefore);

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // And the next turn rides the track, as every turn before the press did.
  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  assert.notEqual(context.replacedTracks().at(-1), null);
});

test("a press landing again over sealed words re-opens the same turn", async () => {
  const context = harness({ connectionDelayMs: 20 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([1]);
  // Released mid-connect: the words seal for delivery and the device rests.
  context.session.endTurn(true);
  assert.equal(context.pressCaptures[0]?.stopped, true);

  // Pressed again before the channel opened. The sealed delivery is
  // superseded — this press's own release will decide afresh — and capture
  // resumes into the same turn, so neither press's words are lost.
  context.session.beginTurn();
  await deviceArrives();
  const resumed = context.pressCaptures[1];
  assert.ok(resumed);
  resumed.feed([2]);
  await opening;

  // Still held at the open, so the turn is live on both presses' words.
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.deepEqual(context.sent, [
    ...inputAudioFormatUpdateEvents(),
    { type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR },
    ...inputAudioAppendEvents(new Int16Array([1])),
    ...inputAudioAppendEvents(new Int16Array([2])),
  ]);

  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(resumed.stopped, true);
});

test("a re-press whose device trails the channel still carries the sealed words", async () => {
  const context = harness({ connectionDelayMs: 10 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([1]);
  // Released mid-connect: the words seal and the device rests.
  context.session.endTurn(true);

  // Pressed again — but this time the channel opens before the re-press's
  // device has answered, so the turn's device arrives on a connected call.
  context.gateMicrophone();
  context.session.beginTurn();
  assert.equal(await opening, true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  context.ungateMicrophone();
  await deviceArrives();

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The re-opened turn still owes the sealed words: it opens as the captured
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // turn it began as, never as a track turn whose clear would wipe them.
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.deepEqual(context.sent, [
    ...inputAudioFormatUpdateEvents(),
    { type: REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR },
    ...inputAudioAppendEvents(new Int16Array([1])),
  ]);
  const resumed = context.pressCaptures[1];
  assert.ok(resumed);
  resumed.feed([2]);
  assert.deepEqual(context.sent.at(-1), inputAudioAppendEvents(new Int16Array([2]))[0]);

  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.turnPending, false);
  assert.notEqual(context.replacedTracks().at(-1), null);
});

test("a re-press released before its device arrives still delivers the sealed words", async () => {
  const context = harness({ connectionDelayMs: 10 });

  context.session.beginTurn();
  const opening = context.session.connect();
  await deviceArrives();
  context.pressCaptures[0]?.feed([3]);
  context.session.endTurn(true);

  context.gateMicrophone();
  context.session.beginTurn();
  assert.equal(await opening, true);
  // Let go again while the re-press's device is still opening: the re-press
  // itself captured nothing, but the sealed words it re-opened are still
  // owed, and the press is not left standing forever behind a delivery
  // nothing would ever trigger.
  context.session.endTurn(true);

  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.turnPending, false);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.SESSION_UPDATE,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  assert.deepEqual(context.sent[2], inputAudioAppendEvents(new Int16Array([3]))[0]);

  // The device that was still opening arrives to a turn already delivered:
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // nobody is talking into it, so it closes as fast as it arrived.
  context.ungateMicrophone();
  await deviceArrives();
  assert.equal(context.microphoneStopped(), true);
});

test("a speak-only call captures nothing, however long a press waits", async () => {
  const context = harness();

  context.session.beginTurn();
  assert.equal(await context.session.connect({ microphone: false }), true);
  await deviceArrives();

  // Luke's own call takes no device: one the press opened ahead of it is
  // released the moment it answers, nothing is captured, and the press stays
  // pending for the developer's call.
  assert.deepEqual(context.pressCaptures, []);
  assert.equal(context.session.turnPending, true);
  assert.equal(context.microphoneEnabled(), false);
});

test("a press does not outlive the call it failed to open", async () => {
  const context = harness({ connection: undefined });

  context.session.toggleTurn();
  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.UNAVAILABLE);

  // The key appears later and something opens a call. Nobody has pressed
  // anything since, so nothing may be listening on the other side of it.
  context.provideConnection();
  assert.equal(await context.session.connect(), true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.microphoneEnabled(), false);
});

test("a reply that runs out before the model says so still ends", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // Playback finishing and generation finishing have no fixed order. The meter
  // reports an edge, so this quiet is the only one there will be — waiting for
  // a second would hold the turn open until the settle timeout.
  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });

  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("the reply ends when the server says the audio ran out", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  // Generation finishing is not speech finishing, so the turn holds.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("audio draining before response.done does not free the turn early", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The audio runs out while the server still owes the reply its done —
  // generation finishing and playback finishing have no fixed order. Until
  // that done the conversation holds an active response, and a turn ended
  // here offers READY to callers with a reply of their own to ask for.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The briefing that queued behind the reply is refused rather than sent:
  // the create it would open is the one the service refuses as a
  // conversation already in progress, surfacing the refusal as a voice error
  // with the briefing lost behind it.
  assert.equal(context.session.speak(briefingAbout("session-a")), false);
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    1,
  );

  // The server concluding the reply is what ends the turn — the drain's
  // deferred ending lands with the done — and only then is the next reply
  // welcome.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.session.speak(briefingAbout("session-a")), true);
  assert.deepEqual(reportedErrors(context), []);
});

test("audio resuming after a mid-reply drain keeps the turn for the second half", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // A reply with two things to say can drain the buffer between them. The
  // stop is remembered as a deferred ending, and the audio starting again is
  // what says it was a pause instead.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED });

  // Generation concludes while the second half is still audible. A stale
  // drain here ended the turn under it — the face and the duck released
  // while Luke was still speaking.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The second half's own drain is the ending that lands.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.deepEqual(reportedErrors(context), []);
});

test("a drain's backstop restarts when the audio resumes", async (t) => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS - 1_000);

  // The resume is when Luke was last heard, so the backstop measures from
  // it: the pause's nearly spent clock must not cut the second half short.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STARTED });
  t.mock.timers.tick(1_000);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // A done that never comes still meets the restarted backstop.
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a briefing queued mid-reply waits out the server's own ending", async () => {
  // The reported shape of the fault, whole: Luke is reading one briefing out
  // on his own call when another agent finishes. The second briefing must
  // wait for the server to conclude the first reply — not for the audio
  // alone — or its create collides with the active response.
  let queue: BriefingQueue | undefined;
  const context = harness({ onStatus: (status) => queue?.onStatus(status) });
  const timers: (() => void)[] = [];
  queue = new BriefingQueue({
    session: () => context.session,
    schedule: (callback) => {
      timers.push(callback);
      return timers.length - 1;
    },
    cancel: () => undefined,
  });

  queue.enqueue(briefingAbout("session-a"));
  // The call the queue opens for itself is a handshake away.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The second agent finishes mid-reply, and then the first reply's audio
  // drains before its done arrives.
  queue.enqueue(briefingAbout("session-b"));
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  // One reply asked for so far: the drain freed nothing, so the READY edge
  // the queue rides has not fired into the server's open response.
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    1,
  );

  // The server concludes the first reply, and the second speaks on that edge.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    2,
  );
  assert.deepEqual(reportedErrors(context), []);
});

test("a done that never follows the drained audio still ends the turn", async (t) => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // A turn that never ends is worse than one that ends early: the settle
  // backstop closes what the missing done left open.
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("an error behind a confirmed reply does not end the turn under it", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // An aside mid-reply — a refused truncate, a warning — is surfaced, but the
  // reply is still the server's: ending the turn on it is what offered READY
  // while the conversation still held an active response.
  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "An aside" } });
  assert.ok(context.errors.includes("An aside"));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The reply's own ending still ends it.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a reply the server refused outright still frees the turn at its error", async () => {
  const context = harness();
  await context.session.connect();
  const spoken = context.session.speak(briefingAbout("session-a"));
  assert.equal(spoken, true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // No response.created ever came: the error is the create's own refusal,
  // and it is all the ending this reply will get.
  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "Rate limited" } });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a reply the server says made no sound ends at response.done", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // A success is said with silence, so the follow-up after a tool call is
  // often exactly this: a finished reply with no audio in its output. The
  // meter will never hear him and never call him quiet, so the turn must end
  // here rather than waiting out the settle backstop with the face up.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: { output: [{ type: "message", id: "item-1", content: [] }] },
  });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("two sentences are one reply, whatever the pause between them", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();

  // One reply that ends properly, which is how this call shows it reports the
  // end of its own audio.
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  // A longer one. Generation finishes while he is still on the first sentence.
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.session.reportRemoteAudioActive();
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });

  // The gap before the second sentence. Silence long enough to look like an
  // ending, on a call that has already shown it reports real ones.
  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING, "he is still talking");
  context.session.reportRemoteAudioActive();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a call that never reports an ending still ends its replies", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.session.reportRemoteAudioActive();
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });

  // Nothing has ever said when audio runs out here, so the quiet is all there
  // is to go on. A turn that never ends is worse than one that ends early.
  context.session.reportRemoteAudioIdle();

  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a pause mid-reply is not the reply running out", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();

  // Long enough between two sentences for the meter to call it quiet, and then
  // he carries on. Ending here would take the meter and the face down with Luke
  // still speaking, which is the whole reason the turn does not end on quiet
  // alone.
  context.session.reportRemoteAudioIdle();
  context.session.reportRemoteAudioActive();
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a sentence pause is not the reply running out", async (t) => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.session.reportRemoteAudioLevel(true);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The meter calls quiet after a fifth of a second, which is shorter than the
  // pause between two sentences. Ending a turn on that would take the meter
  // down mid-reply — the very thing the debounce is here to stop.
  context.session.reportRemoteAudioLevel(false);
  t.mock.timers.tick(220);
  assert.equal(
    context.session.status,
    REALTIME_STATUS.RESPONDING,
    "the pause between two sentences",
  );

  context.session.reportRemoteAudioLevel(true);
  context.session.reportRemoteAudioLevel(false);
  t.mock.timers.tick(REMOTE_QUIET_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("the quiet before Luke starts is not Luke going quiet", () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // One meter draws both halves of the conversation. It reports quiet as it
  // lets go of the microphone and again in the gap before the first word comes
  // back, and neither of those silences is his to answer for — reading them as
  // his takes his waveform down while he is still speaking.
  assert.equal(
    quietIsLukesOwn({ status: REALTIME_STATUS.RESPONDING, heardLuke: false }),
    false,
    "the gap before the reply starts",
  );
  assert.equal(quietIsLukesOwn({ status: REALTIME_STATUS.LISTENING, heardLuke: false }), false);
  // The developer pausing mid-question is the developer's silence, whatever the
  // meter last heard.
  assert.equal(quietIsLukesOwn({ status: REALTIME_STATUS.LISTENING, heardLuke: true }), false);
  assert.equal(quietIsLukesOwn({ status: REALTIME_STATUS.RESPONDING, heardLuke: true }), true);
});

test("a reply is not over when the model stops producing it", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // `response.done` says generation finished. The audio it produced is still
  // playing, so taking the turn down here strips the meter off a talking Luke.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("quiet before the model has finished is a pause, not the end", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();

  // Luke draws breath mid-sentence; the reply is still coming.
  context.session.reportRemoteAudioIdle();

  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a finished response returns the session to ready", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.session.reportRemoteAudioIdle();

  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a changed pace reaches the live call without waiting for the next one", async () => {
  const context = harness();
  await context.session.connect();

  context.session.applySpeed(1.25);

  const update = context.sent.find(
    (event) =>
      event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionAudioField(event) !== undefined,
  );
  assert.deepEqual(update, {
    type: REALTIME_CLIENT_EVENT.SESSION_UPDATE,
    session: { type: "realtime", audio: { output: { speed: 1.25 } } },
  });
});

test("a pace changed mid-reply waits for the reply to end", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The API applies a pace only between turns, so nothing may be sent while
  // Luke is still speaking.
  context.session.applySpeed(0.75);
  assert.equal(
    context.sent.some(
      (event) =>
        event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE &&
        sessionAudioField(event) !== undefined,
    ),
    false,
  );

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  const update = context.sent.find(
    (event) =>
      event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionAudioField(event) !== undefined,
  );
  assert.deepEqual(update?.session, { type: "realtime", audio: { output: { speed: 0.75 } } });
});

test("a pace changed during the handshake reaches the call it was opening", async () => {
  const context = harness({ connectionDelayMs: 5 });
  const opening = context.session.connect();

  // The credential this call answers with may have been minted before the
  // change reached the minter, so dropping it would leave the live call at
  // the old pace with the row already showing the new one.
  context.session.applySpeed(1.25);
  await opening;

  const update = context.sent.find(
    (event) =>
      event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionAudioField(event) !== undefined,
  );
  assert.deepEqual(update?.session, { type: "realtime", audio: { output: { speed: 1.25 } } });
});

test("a pace change with no call open sends nothing", () => {
  // Not a loss: the next call is minted at the stored pace already.
  const context = harness();

  context.session.applySpeed(1.5);

  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
});

test("a service error is surfaced rather than swallowed", async () => {
  const context = harness();
  await context.session.connect();

  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "Session expired" } });

  assert.ok(context.errors.includes("Session expired"));
});

test("malformed server data never breaks the session", async () => {
  const context = harness();
  await context.session.connect();

  context.emit("not an object");
  context.emitRaw("{");
  // A frame outside the protocol is dropped by the handler rather than thrown.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a failed call releases the microphone instead of stranding it", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  assert.equal(context.microphoneEnabled(), true);

  context.setConnectionState("failed");

  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  // FAILED offers "Start voice" again, so nothing may still hold the device.
  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.isConnected, false);
});

test("a disconnect reported after a failure keeps the call failed", async () => {
  const context = harness();
  await context.session.connect();

  context.setConnectionState("failed");
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);

  // The SDK's own disconnect can land a tick after the failure tore the call
  // down; "Voice off" for a call that failed would hide the retry.
  context.closeChannel();
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
});

test("a replaced peer's late failure does not end the new call", async () => {
  const context = harness();
  await context.session.connect();
  await context.session.close();
  await context.session.connect();
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  context.failStalePeer();

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.session.isConnected, true);
});

test("a stalled handshake times out instead of hanging on connecting", async () => {
  const context = harness({ channelOpensImmediately: false, connectTimeoutMs: 40 });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  // No press, no device: the stall held nothing that needs releasing.
  assert.ok(!context.calls.includes("microphone-requested"));
  assert.ok(context.errors.some((message) => message?.includes("timed out")));
});

test("a recoverable disconnect does not end the call", async () => {
  const context = harness();
  await context.session.connect();

  context.setConnectionState("disconnected");

  // ICE routinely passes through `disconnected` on a blip.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.session.isConnected, true);

  context.setConnectionState("failed");
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
});

test("an unexpected channel close releases the microphone", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);

  context.closeChannel();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
});

test("an error instead of response.done still frees the turn", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // An empty push-to-talk commit reports an error with no matching done.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: { message: "Audio buffer is empty" },
  });

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // Turn-taking still works rather than being stuck forever.
  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("an error that is not ours is still reported and still ends the turn", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: { type: "invalid_request_error", message: "The commit held no audio." },
  });

  assert.deepEqual(reportedErrors(context), ["The commit held no audio."]);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a transport close failure cannot strand teardown or the next call", async () => {
  const context = harness({ sdkCloseError: new Error("close failed") });
  await context.session.connect();
  await holdTurn(context);

  context.session.clearConversation();

  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.microphoneStopped(), true);
  assert.deepEqual(reportedErrors(context), ["close failed"]);
  assert.equal(await context.session.connect(), true);
  assert.doesNotThrow(() => context.session.clearConversation());
});

test("a reply ending at teardown still hands its words over, once", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "Half a sentence.",
  });

  // The call drops mid-reply. The words are still handed over — the caller's
  // history keeps them — and the retired call keeps nothing pending, so the
  // next call starts clean.
  context.closeChannel();
  assert.deepEqual(context.replyEndings, [
    { texts: ["Half a sentence."], about: undefined, kind: undefined },
  ]);
  assert.equal(context.captions.at(-1), undefined);

  await context.session.connect();
  await armDeveloperTurn(context);
  assert.equal(context.replyEndings.length, 1);
});

test("the developer's spoken words come back only from their own call", async () => {
  const context = harness();
  await context.session.connect();

  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
    item_id: "item-1",
    transcript: "how is the checkout agent doing?",
  });

  assert.deepEqual(context.spokenAsks, ["how is the checkout agent doing?"]);
});

test("a transcription that came back empty still hands its turn back", async () => {
  const context = harness();
  await context.session.connect();

  // The empty words record nothing — the caller's own paths refuse them —
  // but the turn ending is what lets a preview built from deltas leave.
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
    item_id: "item-1",
    transcript: "  ",
  });

  assert.deepEqual(context.spokenAsks, [""]);
});

test("a developer turn is identified before its transcript returns", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  assert.equal(context.spokenAskClosures(), 1);
  assert.deepEqual(context.spokenAskItems, []);

  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_BUFFER_COMMITTED,
    item_id: "item-1",
  });

  assert.deepEqual(context.spokenAskItems, ["item-1"]);
});

test("a speak-only call has no spoken turns to hand back", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });

  // The speak-only shape offers no microphone, so a transcription arriving on
  // it speaks for nobody: the guard keeps a stray event from ever writing a
  // developer line into the history.
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_COMPLETED,
    item_id: "item-1",
    transcript: "how is the checkout agent doing?",
  });

  assert.deepEqual(context.spokenAsks, []);
});

test("the developer's spoken words preview as they are transcribed", async () => {
  const context = harness();
  await context.session.connect();

  // Each piece is handed over as it arrives, keyed by its own turn, so the
  // caller can grow the right preview while the completed transcript is
  // still on the service's clock — and a failure hands the turn back so the
  // preview can leave instead of streaming forever.
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA,
    item_id: "item-1",
    delta: "how is the",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA,
    item_id: "item-1",
    delta: " checkout agent doing?",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_FAILED,
    item_id: "item-2",
  });

  assert.deepEqual(context.spokenAskDeltas, [
    { itemId: "item-1", delta: "how is the" },
    { itemId: "item-1", delta: " checkout agent doing?" },
  ]);
  assert.deepEqual(context.spokenAskFailures, ["item-2"]);
});

test("a speak-only call has no spoken words taking shape either", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });

  // The completed transcript's microphone guard, applied to its preview and
  // its failure alike.
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_DELTA,
    item_id: "item-1",
    delta: "how is the",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.INPUT_AUDIO_TRANSCRIPTION_FAILED,
    item_id: "item-1",
  });

  assert.deepEqual(context.spokenAskDeltas, []);
  assert.deepEqual(context.spokenAskFailures, []);
});

test("a reply hands its words back as it ends, whole and once", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "The checkout work is done.",
  });
  assert.deepEqual(context.replyEndings, []);

  // However the reply ends — here the developer talking over it — its words
  // are handed over exactly once, at the moment they are final and still
  // known, so the caller can record them for the next call to remember.
  context.session.stopSpeaking();

  // A reply the brain was not asked for is about no session and is neither a
  // briefing nor an answer: History records it as plain words.
  assert.deepEqual(context.replyEndings, [
    { texts: ["The checkout work is done."], about: undefined, kind: undefined },
  ]);
});

test("a briefing's reply hands its subject and its kind back with the words", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });

  context.session.speak(briefingAbout("session-a", "Claude Code finished checkout-service."));
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "Claude Code finished checkout-service.",
  });
  context.session.stopSpeaking();

  // The subject rides along so the caller can store the spoken transcript
  // with the identity the brain's decision carried, and the kind says it was
  // a briefing rather than an answer.
  assert.deepEqual(context.replyEndings, [
    {
      texts: ["Claude Code finished checkout-service."],
      about: ["session-a"],
      kind: REPLY_KIND.BRIEFING,
    },
  ]);
});

test("an onboarding beat is about no session and hands its words back as plain words", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });

  assert.equal(
    context.session.speak({
      kind: ARRIVAL_SPEECH_KIND,
      sessionTitle: "Claude Code: checkout-service",
      talkKeyLabel: "the right Option key",
      decidedAt: Date.now(),
    }),
    true,
  );
  // The beat's turn is opened with no tools, and no notice may stand under the
  // housing claiming it is about an observed session.
  const response = context.sent.at(-1)?.response;
  assert.ok(isRecord(response));
  assert.equal(response.tool_choice, "none");
  assert.deepEqual(context.captionSubjects, []);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "You're all set.",
  });
  assert.deepEqual(context.captionSubjects, [undefined]);
  settleReply(context);
  assert.deepEqual(context.replyEndings, [
    { texts: ["You're all set."], about: undefined, kind: undefined },
  ]);

  // The calendar beat keeps the same terms.
  assert.equal(
    context.session.speak({ kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: Date.now() }),
    true,
  );
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Your calendar can quiet me.",
  });
  settleReply(context);
  assert.deepEqual(context.replyEndings.at(-1), {
    texts: ["Your calendar can quiet me."],
    about: undefined,
    kind: undefined,
  });
});

test("a failed briefing delivery leaves no transcript for History", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });
  context.session.speak(briefingAbout("session-a", "Checkout finished."));
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Checkout finished.",
  });

  context.closeChannel();

  assert.deepEqual(context.replyEndings, []);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a refused call still reads as failed after the channel finishes closing", async () => {
  const context = harness({ sdpResponse: new Response("nope", { status: 403 }) });

  await context.session.connect();
  // The real channel's onclose lands a tick later; it must not rewrite `failed`
  // to `idle`, which would show "Voice off" for a call that actually failed.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
});

test("a deadline that fired during the exchange does not hang the handshake", async () => {
  const context = harness({
    channelOpensImmediately: false,
    connectTimeoutMs: 20,
    // The exchange itself outlives the deadline, so no future abort is coming.
    sdpDelayMs: 40,
  });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  // No press was waiting, so the stalled handshake held no device either.
  assert.ok(!context.calls.includes("microphone-requested"));
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stop during minting is not reported as unavailable", async () => {
  // The stop lands first, then the mint comes back empty. Without the guard the
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // empty result is treated as a fresh diagnosis and overwrites the idle state
  // the developer asked for.
  const context = harness({ connectionDelayMs: 20, connection: undefined });

  const connecting = context.session.connect();
  await context.session.close();

  assert.equal(await connecting, false);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stop during minting is not reported as a failure", async () => {
  const context = harness({ connectionDelayMs: 20, connectionError: new Error("bridge gone") });

  const connecting = context.session.connect();
  await context.session.close();

  assert.equal(await connecting, false);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  // A deliberate stop must not put an error on screen.
  assert.deepEqual(
    context.errors.filter((message) => message !== undefined),
    [],
  );
});

test("push-to-talk reports whether it opened a turn", async () => {
  const context = harness();

  // Nothing to talk into, so the caller must be able to leave the key alone.
  assert.equal(context.session.startListening(), false);

  await context.session.connect();
  // Connected but deviceless is still not a turn: the press opens the device
  // first, and only a device already at hand opens a turn on the spot.
  assert.equal(context.session.startListening(), false);
  await holdTurn(context);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a stop that beats the device still releases it", async () => {
  // The press asks for the device and the stop lands before it arrives, so
  // the device shows up with nobody left to hold it. Adopting it would leave
  // the indicator lit with nothing to close it; it is stopped instead.
  const context = harness();
  await context.session.connect();

  context.session.beginTurn();
  await context.session.close();
  await deviceArrives();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
});

test("a turn is refused while another is already under way", async () => {
  const context = harness();
  await context.session.connect();
  const speech = briefingAbout("session-a", "The checkout service needs a decision.");

  // While the developer holds the microphone open.
  await holdTurn(context);
  assert.equal(context.session.speak(speech), false);
  assert.equal(context.session.startListening(), false);

  // And while Luke is answering: Luke does not talk over itself, and a typed
  // message waits — but the developer taking the microphone always may, which
  // is what makes one key able to interrupt.
  context.session.stopListening(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(speech), false);

  // Exactly one response was ever asked for.
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    1,
  );

  // The turn is still Luke's until his audio stops, so it frees on the quiet
  // rather than on generation finishing.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  assert.equal(context.session.speak(speech), false);

  context.session.reportRemoteAudioIdle();
  assert.equal(context.session.speak(speech), true);
});

test("a turn opens from an empty buffer and the key ends it", async () => {
  const context = harness();
  await context.session.connect();
  const sentAfterConnect = context.sent.length;

  // One key: press to open a turn, press again to send it.
  context.session.toggleTurn();
  await deviceArrives();
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  // A muted track still transmits, so a turn has to start from an empty buffer.
  assert.deepEqual(
    context.sent.slice(sentAfterConnect).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR],
  );

  context.session.toggleTurn();
  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual(
    context.sent.slice(sentAfterConnect).map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the tail of an interrupted reply is not heard as the answer to the next", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);

  // Cut him off, say something else, and send it. The cut lands at the
  // press; the turn itself opens once its device does.
  context.session.beginTurn();
  assert.equal(context.lukeAudible(), false);
  await deviceArrives();
  context.session.endTurn(true);

  // The rest of the old reply is still arriving — the server sent it before it
  // was told to stop — so opening the track when the next turn is sent would
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // play it out as though it were the answer.
  assert.equal(context.lukeAudible(), false);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);
});

test("an interrupted reply is trimmed to the part that was heard", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });

  // Half a second of silence before he starts, then two seconds of speech.
  clock = 1_500;
  context.session.reportRemoteAudioActive();
  clock = 3_500;
  const before = context.sent.length;

  context.session.beginTurn();

  const truncate = context.sent
    .slice(before)
    .find((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE);
  assert.ok(truncate, "the record is corrected, not just the sound stopped");
  assert.equal(truncate?.item_id, "item_reply");
  // Two seconds heard, not the two and a half since the reply was asked for:
  // the gap before his first word was never in the room.
  assert.equal(truncate?.audio_end_ms, 2_000);
});

test("a reply cut off before it was heard leaves nothing to correct", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  clock = 1_400;
  const before = context.sent.length;

  // Cut off during the gap before his first word. Nothing reached the room, so
  // there is no impression to undo — and a truncate at zero is refused.
  context.session.beginTurn();

  assert.ok(
    !context.sent
      .slice(before)
      .some((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE),
  );
});

test("each reply is measured from its own first word", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();

  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "first" } });
  clock = 1_100;
  context.session.reportRemoteAudioActive();
  clock = 5_000;
  await holdTurn(context);

  // A second reply, and the clock starts again with it.
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "second" } });
  clock = 6_000;
  context.session.reportRemoteAudioActive();
  clock = 6_750;
  const before = context.sent.length;

  context.session.beginTurn();

  const truncate = context.sent
    .slice(before)
    .find((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE);
  assert.equal(truncate?.item_id, "second");
  assert.equal(truncate?.audio_end_ms, 750);
});

test("an interrupt asks the server to drop what it already sent", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  const before = context.sent.length;

  context.session.beginTurn();

  const events = context.sent.slice(before).map((event) => event.type);
  // Cancelling alone stops the model producing more and leaves everything it
  // already produced on its way down the connection.
  assert.ok(events.includes(REALTIME_CLIENT_EVENT.RESPONSE_CANCEL));
  assert.ok(events.includes(REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR));
  assert.ok(
    events.indexOf(REALTIME_CLIENT_EVENT.RESPONSE_CANCEL) <
      events.indexOf(REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR),
    "the buffer is emptied only once nothing is still filling it",
  );
});

test("a reply that never starts does not leave Luke silenced", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  await holdTurn(context);
  context.session.endTurn(true);
  assert.equal(context.lukeAudible(), false);

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // An empty commit comes back as an error instead of a reply. Waiting for a
  // `response.created` that is never coming would leave Luke mute for good.
  context.emit({ type: REALTIME_SERVER_EVENT.ERROR, error: { message: "buffer too small" } });

  assert.equal(context.lukeAudible(), true);
});

test("taking the turn silences Luke rather than only stopping generation", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  // Audible once the server says the reply is under way, rather than when it
  // was asked for: until then anything arriving belongs to whatever came before.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);

  context.session.toggleTurn();

  // Cancelling stops the model producing more; it does not stop what is already
  // on its way down the connection. Only this end can — and at the press, not
  // once the device arrives.
  assert.equal(context.lukeAudible(), false);
  await deviceArrives();
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  // The next reply has to be audible again.
  context.session.toggleTurn();
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);
});

test("taking the turn cuts Luke off mid-reply", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  await deviceArrives();
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  context.sent.length = 0;

  context.session.toggleTurn();
  await deviceArrives();

  // The developer's turn always wins: the reply is stopped, not queued behind.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      // What the model already produced is dropped as well, or the rest of the
      // sentence plays on over the turn that interrupted it.
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
    ],
  );
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
});

test("a stop cuts the reply where it stands and opens nothing in its place", async () => {
  let clock = 1_000;
  const context = harness({ now: () => clock });
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item_reply",
    delta: "There are two sessions",
  });
  context.session.reportRemoteAudioActive();
  clock = 2_500;
  const before = context.sent.length;

  assert.equal(context.session.stopSpeaking(), true);

  // The cut is the same one talking over him makes — silenced at once,
  // cancelled, and trimmed to the second and a half that was heard — but the
  // turn ends there: no microphone opens and no reply is asked for.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.lukeAudible(), false);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.captions.at(-1), undefined);
  const events = context.sent.slice(before);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
    ],
  );
  assert.equal(events.at(-1)?.audio_end_ms, 1_500);

  // The next reply has to be audible again.
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);
});

test("a stop does not surface the server refusing its already-finished cancellation", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  assert.equal(context.session.stopSpeaking(), true);
  const cancellation = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
  );

  // Generation can finish at the service while its buffered audio is still
  // playing here. The local stop still succeeded, so the refusal of its now
  // redundant cancel is not a failure the developer can or should act on.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "invalid_request_error",
      message: "Cancellation failed: no active response found",
      event_id: cancellation?.event_id,
    },
  });

  assert.deepEqual(reportedErrors(context), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a stop does not surface the server refusing a trim past the audio's end", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.session.reportRemoteAudioActive();

  assert.equal(context.session.stopSpeaking(), true);
  const truncate = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
  );
  assert.ok(truncate);

  // The audible clock runs on the wall, so a stop landing at the reply's very
  // end can measure past the audio itself. The refusal names no event — a null
  // `event_id` is the shape the service actually sends — so the sentence is
  // all there is to recognize it by, and nothing about it is the developer's
  // to act on.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "invalid_request_error",
      code: "invalid_value",
      message: "Audio content of 1500ms is already shorter than 2000ms",
      event_id: null,
    },
  });

  assert.deepEqual(reportedErrors(context), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a real error answering the stop's trim is still surfaced", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.session.reportRemoteAudioActive();

  assert.equal(context.session.stopSpeaking(), true);
  const truncate = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
  );
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "server_error",
      message: "Truncation could not be processed.",
      event_id: truncate?.event_id,
    },
  });

  assert.deepEqual(reportedErrors(context), ["Truncation could not be processed."]);
});

test("a stop after the reply's audio ran out leaves nothing to trim", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item_reply" },
  });
  context.session.reportRemoteAudioActive();

  // The audio runs out while the server still owes the reply its done, so the
  // turn holds and a stop can still land on it. Every word already reached the
  // room: there is nothing to correct, and a trim measured on the wall clock
  // would ask past the audio's end and be refused.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED, response_id: "resp-1" });
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  const before = context.sent.length;

  assert.equal(context.session.stopSpeaking(), true);

  assert.ok(
    !context.sent
      .slice(before)
      .some((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE),
  );
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a stale drain from the spoken half does not skip the follow-up's trim", async () => {
  let clock = 1_000;
  const context = harness({
    now: () => clock,
    askBrain: async () => brainAnswer("Sent.", "session-a"),
  });
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "spoken" } });
  context.session.reportRemoteAudioActive();

  // The reply asks the brain, its follow-up is asked for, and only then does
  // the spoken half's buffer report itself empty: the drain is the old
  // reply's, arriving after the follow-up already owns the turn.
  context.emit(askBrainDone("run the tests", { responseId: "resp-1" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED, response_id: "resp-1" });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-2" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "follow_up" },
  });
  clock = 2_000;
  context.session.reportRemoteAudioActive();
  clock = 2_800;
  const before = context.sent.length;

  // A stop mid-follow-up still owes the record a trim: the words cut off were
  // the follow-up's own, and the stale drain spoke for audio it never played.
  assert.equal(context.session.stopSpeaking(), true);

  const truncate = context.sent
    .slice(before)
    .find((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE);
  assert.ok(truncate, "the follow-up's record is corrected despite the spoken half's drain");
  assert.equal(truncate?.item_id, "follow_up");
  assert.equal(truncate?.audio_end_ms, 800);
});

test("a stop after response.done clears playback without cancelling finished generation", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  const before = context.sent.length;

  assert.equal(context.session.stopSpeaking(), true);

  const events = context.sent.slice(before);
  assert.equal(
    events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CANCEL),
    false,
  );
  const clear = events.find(
    (event) => event.type === REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
  );
  assert.match(String(clear?.event_id), /^output_audio_clear_/);
});

test("a real error answering the stop's cancellation is still surfaced", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  assert.equal(context.session.stopSpeaking(), true);
  const cancellation = context.sent.findLast(
    (event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
  );
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "server_error",
      code: "realtime_unavailable",
      message: "Cancellation could not be processed.",
      event_id: cancellation?.event_id,
    },
  });

  assert.deepEqual(reportedErrors(context), ["Cancellation could not be processed."]);
});

test("a stop with nothing being spoken reports so and sends nothing", async () => {
  const context = harness();
  await context.session.connect();
  const before = context.sent.length;

  // Ready is not a reply, and neither is the developer's own open microphone:
  // the key that asked keeps its other meanings.
  assert.equal(context.session.stopSpeaking(), false);
  await holdTurn(context);
  assert.equal(context.session.stopSpeaking(), false);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  assert.deepEqual(
    context.sent.slice(before).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR],
  );
});

test("a stop that races the reply's confirmation still holds", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  context.deliverRemoteTrack();
  // The stop lands in the gap between asking for the reply and the server
  // confirming it: the cancel and the confirmation cross on the wire.
  await armDeveloperTurn(context);
  assert.equal(context.session.stopSpeaking(), true);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });

  // The late confirmation is the cancelled reply's own. Adopting it would
  // re-open the track over the quiet just asked for.
  assert.equal(context.lukeAudible(), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  // And its finished form must not reach the brain: the turn it belonged to
  // ended with the stop.
  const before = context.sent.length;
  context.emit(askBrainDone("do it anyway", { callId: "call-late", responseId: "resp-a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, before), [
    {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That turn is over; ask again if it still matters.",
    },
  ]);
  assert.deepEqual(responseCreates(context, before), []);

  // The next reply the developer actually asks for is heard again.
  context.session.sendText("what needs me?");
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-b" } });
  assert.equal(context.lukeAudible(), true);
});

test("a stopped reply's brain follow-up stands down instead of speaking over the quiet", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  context.emit(askBrainDone("add tests", { responseId: "resp-a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(answer, "the ask is out when the stop lands");

  // The developer asks for quiet while the brain is still thinking.
  assert.equal(context.session.stopSpeaking(), true);
  const before = context.sent.length;
  answer?.(brainAnswer("Sent.", "session-a"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The answer is still delivered as an item, so the model is not left
  // waiting — but no reply opens to voice it: the quiet just asked for holds.
  assert.deepEqual(toolOutputs(context, before), [{ briefing: "Sent." }]);
  assert.deepEqual(responseCreates(context, before), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("closing stops the microphone track", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);

  await context.session.close();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
});

test("clearing a conversation retires its call before another turn can begin", async () => {
  const context = harness();
  await context.session.connect();
  assert.equal(context.session.sendText("This real turn belongs to the old call."), true);

  context.session.clearConversation();

  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
  await context.session.connect();
  await armDeveloperTurn(context);

  // The next turn rides a fresh call, so the server-side conversation the
  // cleared words lived in is gone with the old one.
  assert.equal(context.requests.length, 2);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a typed ask opens a developer turn and asks for the reply to it", async () => {
  const context = harness();
  await context.session.connect();
  const sentBefore = context.sent.length;

  assert.equal(context.session.sendText("What needs me right now?"), true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The microphone stays exactly as it was: typing never opens the device.
  assert.equal(context.microphoneEnabled(), false);
  const events = context.sent.slice(sentBefore);
  assert.deepEqual(
    events.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const item = events[0]?.item as { role?: string; content?: { text?: string }[] };
  assert.equal(item.role, "user");
  assert.equal(item.content?.[0]?.text, "What needs me right now?");
});

test("a typed ask's reply can ask the brain, exactly as a spoken one's can", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Asked.", "session-a") });
  await context.session.connect();
  // The turn is opened by typing rather than by the talk key: both are the
  // developer's own ask, and the voice's one tool answers in either.
  context.session.sendText("ask claude code to add tests");

  context.emit(askBrainDone("ask claude code to add tests"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(context.asked, ["ask claude code to add tests"]);
  // The answer is voiced, exactly as a spoken ask's would be.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.deepEqual(context.captionSubjects.at(-1), ["session-a"]);
});

test("a typed ask interrupts the reply it arrives over", async () => {
  let now = 10_000;
  const context = harness({ now: () => now });
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-1" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-1",
    delta: "There are two sessions",
  });
  context.session.reportRemoteAudioActive();
  now = 11_200;
  const sentBefore = context.sent.length;

  assert.equal(context.session.sendText("open the codex one"), true);

  // The reply being talked over is cut the way holding the talk key cuts it:
  // silenced at once, cancelled, and trimmed to what was actually heard.
  assert.equal(context.lukeAudible(), false);
  assert.equal(context.captions.at(-1), undefined);
  const events = context.sent.slice(sentBefore);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_TRUNCATE,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a cancelled reply's late finish cannot ask the brain in the turn that replaced it", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  // A spoken turn opens reply A, and the server confirms it by name.
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  // The developer types over it, opening a new turn.
  assert.equal(context.session.sendText("never mind — what needs me?"), true);
  const sentBefore = context.sent.length;

  // Reply A's finished form arrives late — the server had completed it before
  // the cancel landed — carrying the very ask the developer interrupted.
  context.emit(askBrainDone("do it anyway", { callId: "call-stale", responseId: "resp-a" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Nothing reached the brain: only the freshness of the reply stands between
  // the call and the ask, and it holds against a turn the developer moved on
  // from.
  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That turn is over; ask again if it still matters.",
    },
  ]);
  // No reply was opened to voice the refusal, and the new turn is still under way.
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The reply the typed ask actually asked for still asks in full.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-b" } });
  context.emit(askBrainDone("status?", { callId: "call-fresh", responseId: "resp-b" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(context.asked, ["status?"]);
});

test("a cancelled reply's late finish does not end the turn that replaced it", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  context.session.sendText("actually, open the codex session");

  // Reply A finishes late with nothing to say, while reply B is still in the
  // quiet gap before its first word.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-a" } });
  context.session.reportRemoteAudioIdle();

  // A stale finish must not mark generation done: paired with that gap's
  // quiet, it would end a reply that has not begun to be heard.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a typed ask does not interrupt the developer's own open microphone", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  const sentBefore = context.sent.length;

  // Half a spoken question is still theirs: the keystroke is refused rather
  // than the microphone's turn being discarded under them.
  assert.equal(context.session.sendText("hello"), false);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  assert.deepEqual(context.sent.slice(sentBefore), []);
});

test("a typed ask with nothing in it opens nothing", async () => {
  const context = harness();
  await context.session.connect();
  const sentBefore = context.sent.length;

  assert.equal(context.session.sendText("   "), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.deepEqual(context.sent.slice(sentBefore), []);
});

test("a typed ask before the call is open reports it could not go", () => {
  const context = harness();

  assert.equal(context.session.sendText("What needs me?"), false);
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
});

test("a spoken ask goes to the brain and its answer is voiced about the sessions it named", async () => {
  const context = harness({
    askBrain: async () => brainAnswer("Claude Code is on the tests now.", "session-a"),
  });
  await context.session.connect();
  // The call arrives inside a turn the developer opened by speaking.
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("ask claude code to add tests"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The developer's words reach the brain as the voice passed them, and the
  // brain's reply is the tool's output, for the follow-up to say.
  assert.deepEqual(context.asked, ["ask claude code to add tests"]);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { briefing: "Claude Code is on the tests now." },
  ]);
  // The follow-up that says it carries no tools: it was opened to say what the
  // brain answered, not to ask it again.
  assert.deepEqual(responseCreates(context, sentBefore), [
    { type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE, response: { tools: [], tool_choice: "none" } },
  ]);
  assert.equal(context.sent.at(-1)?.type, REALTIME_CLIENT_EVENT.RESPONSE_CREATE);
  // The turn never ended: the reply resumes over the answer, about the
  // sessions the brain named.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.deepEqual(context.captionSubjects.at(-1), ["session-a"]);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-answer" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-answer",
    delta: "Claude Code is on the tests now.",
  });
  assert.deepEqual(context.captionSubjects.at(-1), ["session-a"]);
  settleReply(context);

  // History records the words as a reply, about the sessions the answer named.
  assert.deepEqual(context.replyEndings, [
    {
      texts: ["Claude Code is on the tests now."],
      about: ["session-a"],
      kind: REPLY_KIND.REPLY,
    },
  ]);
  assert.equal(context.captionSubjects.at(-1), undefined);
});

test("a rejected answer's reason is the tool's output, and the follow-up still speaks", async () => {
  const context = harness({
    askBrain: async () => ({
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That session is no longer observed.",
    }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("open the codex one"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACT_RESULT_STATUS.REJECTED, reason: "That session is no longer observed." },
  ]);
  // The refusal is voiced like any answer, but about no session: nothing the
  // brain refused may put a notice under the housing.
  assert.equal(responseCreates(context, sentBefore).length, 1);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.captionSubjects.at(-1), undefined);
});

test("a call with no brain behind it is refused, and the refusal is voiced", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("what needs me?"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(toolOutputs(context, sentBefore), [
    {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "Luke's judgment is not available on this call.",
    },
  ]);
  assert.equal(responseCreates(context, sentBefore).length, 1);
});

test("an ask carrying no words never reaches the brain", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("   "));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACT_RESULT_STATUS.REJECTED, reason: "The ask carried no words." },
  ]);
});

test("a call to a tool the voice was never given is refused before the brain", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "send_session_message",
          call_id: "call-1",
          arguments:
            '{"provider_id":"claude-code","provider_session_id":"session-a","text":"add tests"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACT_RESULT_STATUS.REJECTED, reason: "No such tool exists." },
  ]);
});

test("a response waits for every ask's answer before one tool-free follow-up", async () => {
  const pending = new Map<string, (result: BrainAskResult) => void>();
  const context = harness({
    askBrain: (question) => new Promise((resolve) => pending.set(question, resolve)),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-tools" } });
  const sentBefore = context.sent.length;

  const calls = [askBrainCall("first", "call-first"), askBrainCall("second", "call-second")];
  for (const item of calls) {
    context.emit({ type: "response.output_item.done", response_id: "resp-tools", item });
  }
  await Promise.resolve();

  pending.get("second")?.(brainAnswer("Second."));
  await new Promise((resolve) => setTimeout(resolve, 0));
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: { id: "resp-tools", output: calls },
  });
  assert.deepEqual(responseCreates(context, sentBefore), []);

  pending.get("first")?.(brainAnswer("First."));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(responseCreates(context, sentBefore), [
    { type: REALTIME_CLIENT_EVENT.RESPONSE_CREATE, response: { tools: [], tool_choice: "none" } },
  ]);
});

test("malformed SDK call details are refused before the brain", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();

  assert.deepEqual(await context.executeSdkTool(ASK_BRAIN_TOOL.name, undefined), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "The tool call was malformed.",
  });
  assert.deepEqual(
    await context.executeSdkTool(ASK_BRAIN_TOOL.name, {
      toolCall: { type: "function_call", callId: "call-1", name: ASK_BRAIN_TOOL.name },
    }),
    { status: ACT_RESULT_STATUS.REJECTED, reason: "The tool arguments were malformed." },
  );
  assert.deepEqual(context.asked, []);
});

test("a brain that throws is refused with a bounded reason", async () => {
  const context = harness({
    askBrain: async () => {
      throw new Error("The bridge dropped the ask.");
    },
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("add tests"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The error's own words never reach the model; the refusal is fixed by the build.
  assert.deepEqual(toolOutputs(context, sentBefore), [
    { status: ACT_RESULT_STATUS.REJECTED, reason: "Luke's judgment did not answer." },
  ]);
});

test("the brain's reply to a typed ask is spoken about the sessions it named", async () => {
  const context = harness();
  await context.session.connect();
  const sentBefore = context.sent.length;

  assert.equal(
    context.session.speakReply("Two sessions need you.", [
      { providerId: "claude-code", providerSessionId: "session-a" },
      { providerId: "codex", providerSessionId: "session-b" },
    ]),
    true,
  );

  // The reply travels on the briefing's own out-of-band terms — no tools, no
  // conversation — and the caption is about the sessions the brain named from
  // the moment it is asked for.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  const [request] = responseCreates(context, sentBefore);
  assert.ok(isRecord(request?.response));
  assert.equal(request.response.conversation, "none");
  assert.deepEqual(request.response.tools, []);
  assert.deepEqual(context.captionSubjects.at(-1), ["session-a", "session-b"]);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Two sessions need you.",
  });
  settleReply(context);
  assert.deepEqual(context.replyEndings, [
    {
      texts: ["Two sessions need you."],
      about: ["session-a", "session-b"],
      kind: REPLY_KIND.REPLY,
    },
  ]);
  // A reply with nothing to say opens nothing.
  assert.equal(context.session.speakReply("   ", []), false);
});

test("the brain's reply interrupts the reply it arrives over, never the developer's microphone", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  const sentBefore = context.sent.length;

  assert.equal(context.session.speakReply("Here is the answer.", []), true);
  assert.equal(context.lukeAudible(), false);
  assert.deepEqual(
    context.sent.slice(sentBefore).map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
  settleReply(context);

  // Half a spoken question is still the developer's.
  await holdTurn(context);
  assert.equal(context.session.speakReply("Here is the answer.", []), false);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("the brain's answer is not spoken over a turn the developer has taken", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit(askBrainDone("add tests"));
  // Let the call reach the point where it is awaiting the brain.
  await Promise.resolve();
  // The developer takes the turn while the ask is still out.
  context.session.beginTurn();
  await deviceArrives();
  answer?.(brainAnswer("Sent.", "session-a"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The answer was still delivered as an item, so the model is not left
  // waiting — but no reply was opened to voice it over the microphone now open.
  assert.deepEqual(toolOutputs(context, sentBefore), [{ briefing: "Sent." }]);
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a drained reply that asked the brain holds the turn for the follow-up it owes", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The spoken half's audio drains before the done that carries the call.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();

  // The turn holds while the brain thinks: the READY an ending here would
  // offer is the edge the briefing queue rides, and a briefing taken there
  // would abandon the follow-up that is the answer's only voice.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(briefingAbout("session-b")), false);

  answer?.(brainAnswer("Sent.", "session-a"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up opened: the answer is voiced rather than abandoned.
  assert.equal(responseCreates(context).length, 2);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("an ask out to the brain gets a clock of its own, longer than a reply's", async (t) => {
  const context = harness({ askBrain: () => new Promise(() => undefined) });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The drain arms a backstop for the missing done, and nearly spends it.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS - 1);

  // The done it was watching for arrives, carrying the ask: the hold that
  // follows is the ask's, not the tail of the drain's clock.
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();

  // The drain's leftover moment must not cut the hold while the brain
  // thinks, and neither may a reply's whole settle window: a brain turn reads
  // and may act before it answers.
  t.mock.timers.tick(1);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // An ask that hangs past even the brain's own window still meets a
  // backstop: a turn that never ends is worse than one that ends early.
  assert.ok(BRAIN_ASK_SETTLE_TIMEOUT_MS > REALTIME_SETTLE_TIMEOUT_MS);
  t.mock.timers.tick(BRAIN_ASK_SETTLE_TIMEOUT_MS - REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("audio draining while the ask is out holds the turn the same way", async () => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The ordinary order: the done carrying the ask lands while the spoken half
  // is still audible, and the audio drains while the brain thinks.
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  // The same hold, in the mirror order: no READY edge mid-ask for the
  // briefing queue to take the turn on.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(briefingAbout("session-b")), false);

  answer?.(brainAnswer("Sent.", "session-a"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up opened: the answer is voiced rather than abandoned.
  assert.equal(responseCreates(context).length, 2);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("an answer that outlives the backstop cannot speak out of the spent turn", async (t) => {
  let answer: ((result: BrainAskResult) => void) | undefined;
  const context = harness({
    askBrain: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await Promise.resolve();

  // The ask hangs past the brain's whole window; the backstop declares the
  // turn over, and the developer has been shown the silence.
  t.mock.timers.tick(BRAIN_ASK_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  t.mock.timers.reset();

  const sentBefore = context.sent.length;
  answer?.(brainAnswer("Sent.", "session-a"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The answer is still delivered as an item, so the model is not left
  // waiting — but no reply opens out of a silence already declared.
  assert.deepEqual(toolOutputs(context, sentBefore), [{ briefing: "Sent." }]);
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a done that outlives the settle backstop cannot ask the brain out of the spent turn", async (t) => {
  const context = harness({ askBrain: async () => brainAnswer("Done.") });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The audio drains, the done never follows, and the backstop ends the turn.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  t.mock.timers.reset();

  const sentBefore = context.sent.length;
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The turn ended with the backstop: the late call is answered refused
  // rather than asked out of a turn the developer was already told had
  // ended, and no reply opens over the quiet.
  assert.deepEqual(context.asked, []);
  assert.deepEqual(toolOutputs(context, sentBefore), [
    {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That turn is over; ask again if it still matters.",
    },
  ]);
  assert.deepEqual(responseCreates(context, sentBefore), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("the caption grows with the deltas and the final text supersedes them", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Two sessions ",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "need review.",
  });
  // The server's own rendering of the reply corrects whatever the deltas
  // built, so a delta lost to the channel cannot leave a hole on screen.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    transcript: "Two sessions need review, and one failed.",
  });

  assert.deepEqual(context.captions, [
    ["Two sessions "],
    ["Two sessions need review."],
    ["Two sessions need review, and one failed."],
  ]);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("back-to-back responses stack as two captions instead of running together", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-one" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-one",
    delta: "First response.",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-two" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-two",
    delta: "Second response.",
  });

  // The second response's words start a caption of their own rather than
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // being spliced onto the first's without so much as a space.
  assert.deepEqual(context.captions.at(-1), ["First response.", "Second response."]);

  // The first response's own final rendering lands on its own caption — even
  // though the turn has moved on — instead of erasing the pair.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    item_id: "item-one",
    transcript: "First response, corrected.",
  });
  assert.deepEqual(context.captions.at(-1), ["First response, corrected.", "Second response."]);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    item_id: "item-two",
    transcript: "Second response, finished.",
  });
  assert.deepEqual(context.captions.at(-1), [
    "First response, corrected.",
    "Second response, finished.",
  ]);

  // A third response retires the oldest: only two ever stack.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-three" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-three",
    delta: "Third.",
  });
  assert.deepEqual(context.captions.at(-1), ["Second response, finished.", "Third."]);
});

test("a brain follow-up keeps the words said before the ask and stacks the answer", async () => {
  const context = harness({ askBrain: async () => brainAnswer("Sent.", "session-a") });
  await context.session.connect();
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-ask" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-ask",
    delta: "Sending that now.",
  });
  context.emit(askBrainDone("add tests", { responseId: "resp-1" }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up continues the exchange, so the sentence spoken before the
  // ask stays on the strip and the answer's words stack under it, instead of
  // the answer erasing words still being read.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-outcome" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-outcome",
    delta: "Sent.",
  });
  assert.deepEqual(context.captions.at(-1), ["Sending that now.", "Sent."]);
});

test("the caption leaves when the reply does", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "All quiet.",
  });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  // Generation finishing is not speech finishing: the words stay up while
  // Luke is still saying them.
  assert.deepEqual(context.captions, [["All quiet."]]);

  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  assert.deepEqual(context.captions, [["All quiet."], undefined]);
});

test("a briefing's caption names its sessions; a conversation's names none", async () => {
  const context = harness();
  await context.session.connect();

  // The subject stands from the moment the briefing's reply is asked for —
  // the pressable notice may precede the first word — and every caption of
  // that reply carries it.
  context.session.speak({
    kind: BRIEFING_SPEECH_KIND,
    briefing: "Checkout just finished, and billing wants the migration approved.",
    sessionIds: [
      { providerId: "claude-code", providerSessionId: "session-a" },
      { providerId: "codex", providerSessionId: "session-b" },
    ],
    decidedAt: Date.now(),
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Checkout just finished.",
  });
  assert.deepEqual(context.captions, [undefined, ["Checkout just finished."]]);
  assert.deepEqual(context.captionSubjects, [
    ["session-a", "session-b"],
    ["session-a", "session-b"],
  ]);

  // The reply ending takes the subject with the words: the notice can never
  // outlive the briefing it stands for.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.captions.at(-1), undefined);
  assert.equal(context.captionSubjects.at(-1), undefined);

  // A conversation reply is nobody's briefing, whatever was said before.
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Two sessions need review.",
  });
  assert.deepEqual(context.captions.at(-1), ["Two sessions need review."]);
  assert.equal(context.captionSubjects.at(-1), undefined);
});

test("taking the turn cuts the caption with the audio", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "A sentence the developer is about to talk over",
  });

  // The caption already holds words the room has not heard — the text runs
  // ahead of the speech — so an interrupt must take it down at once rather
  // than leaving Luke finishing a sentence he was stopped from saying. The
  // cut lands at the press, before the device has even opened.
  context.session.beginTurn();

  assert.equal(context.captions.at(-1), undefined);
  assert.equal(context.captions.length, 2);
});

test("a cancelled reply's late transcript cannot pollute the next caption", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-first" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-first",
    delta: "The first reply",
  });

  // Talking over the reply cuts it, but the server had already produced the
  // rest of its transcript, which keeps arriving — around the interrupt, and
  // even after the next reply has been asked for.
  context.session.beginTurn();
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-first",
    delta: ", still streaming in",
  });
  await deviceArrives();
  context.session.stopListening(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DONE,
    item_id: "item-first",
    transcript: "The first reply, finished anyway.",
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED,
    item: { id: "item-second" },
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-second",
    delta: "The second reply",
  });

  assert.deepEqual(context.captions.at(-1), ["The second reply"]);
  assert.equal(
    context.captions.some((caption) => caption?.includes("The first reply, finished anyway.")),
    false,
  );
  assert.equal(
    context.captions.some((caption) =>
      caption?.some((text) => text.includes("still streaming in")),
    ),
    false,
  );
});

test("a speak-only connect never asks for the microphone", async () => {
  const context = harness();

  assert.equal(await context.session.connect({ microphone: false }), true);

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // The device was never requested, so there is no permission to ask and no
  // indicator to light.
  assert.ok(!context.calls.includes("microphone-requested"));
  // The SDK keeps one synthetic track negotiated; no real device rides it.
  assert.equal(context.replacedTracks().length, 0);
  assert.equal(context.silenceTrack.kind, "audio");
  assert.equal(context.session.microphoneCall, false);
});

test("a speak-only call reads a briefing out but refuses a typed ask and its reply", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });
  const sentAfterConnect = context.sent.length;

  assert.equal(context.session.speak(briefingAbout("session-a")), true);
  assert.deepEqual(
    context.sent.slice(sentAfterConnect).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
  settleReply(context);

  // A typed ask is a conversation, and Luke's own call is not one: the caller
  // stands the call down and opens the developer's own. The brain's reply to
  // a typed ask is refused on the same terms.
  assert.equal(context.session.sendText("stop the deploy"), false);
  assert.equal(context.session.speakReply("Stopped.", []), false);
});

test("an idle call stays open until the provider closes it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const context = harness();
  await context.session.connect();

  t.mock.timers.tick(4 * 60_000);

  assert.equal(context.session.isConnected, true);
});

test("the device closes with the exchange and the conversation stays", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  assert.equal(context.microphoneEnabled(), true);

  context.session.stopListening(true);
  settleReply(context);

  // The settle is the device's end — tracks stopped, the sender emptied —
  // while the call, and the conversation on it, stay warm and stay the
  // developer's: the next press reopens the device, never replaces the call.
  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.replacedTracks().at(-1), context.silenceTrack);
  assert.equal(context.session.isConnected, true);
  assert.equal(context.session.microphoneCall, true);
});

test("each exchange opens its own device on the same call", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  settleReply(context);
  const before = context.calls.length;

  context.session.beginTurn();
  // The press is an intention while the device opens, not a turn yet.
  assert.equal(context.session.turnPending, true);
  await deviceArrives();

  assert.deepEqual(context.calls.slice(before), ["microphone-requested"]);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  // The fresh track rode the sender the last one vacated: no new call.
  assert.notEqual(context.replacedTracks().at(-1), null);
  assert.equal(context.session.isConnected, true);
});

test("two presses while the device opens ask for it once", async () => {
  const context = harness();
  await context.session.connect();
  const before = context.calls.length;

  context.session.beginTurn();
  context.session.beginTurn();
  await deviceArrives();

  assert.deepEqual(context.calls.slice(before), ["microphone-requested"]);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a press let go while the device opens drops the turn", async () => {
  const context = harness();
  await context.session.connect();
  const sentAfterConnect = context.sent.length;

  context.session.beginTurn();
  context.session.endTurn(true);
  await deviceArrives();

  // Nothing was captured, so nothing is sent — and the device that arrived
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // for the dropped press closes as fast as it came.
  assert.deepEqual(context.sent.slice(sentAfterConnect), []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.microphoneStopped(), true);
});

test("typing never opens the device", async () => {
  const context = harness();
  await context.session.connect();

  assert.equal(context.session.sendText("How is the checkout fix going?"), true);

  // A typed ask needs no capture device: the ask went, and the device — the
  // part other audio can hear — was never touched.
  assert.ok(!context.calls.includes("microphone-requested"));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a device that arrives for a replaced call is stopped, not adopted", async () => {
  const context = harness();
  await context.session.connect();
  context.gateMicrophone();
  context.session.beginTurn();
  // The call is closed and a fresh one opened while the device is still on
  // its way; the old press's device belongs to nobody.
  await context.session.close();
  await context.session.connect();
  context.ungateMicrophone();
  await deviceArrives();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // Nothing rode the fresh call's sender: no track, not even a release.
  assert.deepEqual(context.replacedTracks(), []);
});

test("a device refused after its call was replaced fails nothing", async () => {
  const context = harness();
  await context.session.connect();
  context.failMicrophone();
  context.session.beginTurn();
  await context.session.close();
  await context.session.connect();
  await deviceArrives();

  // The refusal belonged to the closed call and died with it: the call now
  // up keeps standing, ready for its own press.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.ok(!reportedErrors(context).some((message) => /microphone went away/i.test(message)));
});

test("a press against a fresh call is served once a stale open clears", async () => {
  const context = harness();
  await context.session.connect();
  context.gateMicrophone();
  context.session.beginTurn();
  await context.session.close();
  await context.session.connect();
  // The new call's own press lands while the stale open still holds the
  // single-flight slot; it must wait its turn, not be dropped.
  context.session.beginTurn();
  context.ungateMicrophone();
  await deviceArrives();

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
});

test("a device that vanishes mid-conversation fails the call at the press", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);
  settleReply(context);
  context.failMicrophone();

  context.session.beginTurn();
  await deviceArrives();

  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  assert.equal(context.session.turnPending, false);
  assert.ok(reportedErrors(context).some((message) => /microphone went away/i.test(message)));
});

test("a call that drops goes quietly, because the history lost nothing", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  // The service ends every session at an hour, so this is how a long
  // conversation ordinarily ends rather than an exotic failure — and the
  // conversation lives in the history, which the next press re-feeds, so a
  // warning here would report a loss that no longer happens.
  context.closeChannel();

  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.deepEqual(reportedErrors(context), []);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a call put away on purpose does not report itself as lost", async () => {
  const context = harness();
  await context.session.connect();
  await armDeveloperTurn(context);

  await context.session.close();

  assert.deepEqual(reportedErrors(context), []);
});

test("the developer's call replaces Luke's own and keeps the waiting press", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });

  // The press lands while Luke's call is up: it cannot take a turn there, so
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // it waits as an intention rather than being lost.
  context.session.beginTurn();
  assert.equal(context.microphoneEnabled(), false);

  assert.equal(await context.session.connect(), true);

  // The replacement call has the microphone, and the waiting press opened its
  // turn the moment the call could take one.
  assert.equal(context.session.microphoneCall, true);
  assert.ok(context.calls.includes("microphone-requested"));
  assert.equal(context.microphoneEnabled(), true);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});
