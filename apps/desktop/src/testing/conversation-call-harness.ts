/**
 * One `ConversationCall` driven over a fake SDK transport, and the vocabulary
 * its tests are written in. Shared because the suite is split by concern —
 * connecting, endings, interruption, the brain, the caption, the device — and
 * one harness is what keeps those files describing the same call.
 */
import { BRAIN_ASK_PENDING_NOTE } from "@sidecar/brain/requests";
import { BRAIN_ASK_PENDING_STATUS, type BrainAskResult } from "@sidecar/brain/requests-wire";
import type { TraceDirection } from "@sidecar/devtrace/vocabulary";
import type { RealtimeConnection } from "@sidecar/hosted";
import {
  ASK_BRAIN_TOOL,
  BRIEFING_SPEECH_KIND,
  type BriefingSpeech,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  type RealtimeStatus,
} from "@sidecar/realtime";
import type { ReplyKind } from "@sidecar/voice/orchestrator";
import { ACTION_RESULT_STATUS, isRecord, text, type WireRecord } from "@sidecar/wire";
import type { JsonValue, ParsedJsonObject } from "@sidecar/wire/testing";
import type {
  SdkRealtimeTransport,
  SdkTransportFactoryOptions,
} from "#renderer/voice/agents-realtime-transport";
import { ConversationCall } from "#renderer/voice/conversation-call";
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

export function sessionField(event: ParsedJsonObject | undefined): ParsedJsonObject | undefined {
  if (!event) return undefined;
  const session = event.session;
  return isRecord(session) ? session : undefined;
}

export function sessionAudioField(event: ParsedJsonObject | undefined): JsonValue | undefined {
  return sessionField(event)?.audio;
}

export const CONNECTION: RealtimeConnection = {
  value: "ek_test_secret",
  expiresAt: 1_800_000_060_000,
  model: "gpt-realtime-2.1",
  callsUrl: "https://api.openai.com/v1/realtime/calls",
};

export interface ReplyEnding {
  texts: readonly string[];
  kind: ReplyKind | undefined;
  runId?: string;
}

export interface Harness {
  session: ConversationCall;
  sent: ParsedJsonObject[];
  errors: (string | undefined)[];
  /** Each caption emission: one text per stacked response, or a clear. */
  captions: (readonly string[] | undefined)[];
  /** The words each ended reply left behind, with its kind. */
  replyEndings: ReplyEnding[];
  /** The questions the voice asked the brain, in order. */
  asked: string[];
  /** The submission id each ask travelled under: the tool call's own id. */
  submissions: string[];
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

/** An answer the brain accepted: words to say. */
export function brainAnswer(briefing: string, runId = "run-1"): BrainAskResult {
  return { status: ACTION_RESULT_STATUS.ACCEPTED, briefing, runId };
}

export function brainPending(): BrainAskResult {
  return { status: BRAIN_ASK_PENDING_STATUS, note: BRAIN_ASK_PENDING_NOTE };
}

export function harness(
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
  const replyEndings: ReplyEnding[] = [];
  const asked: string[] = [];
  const submissions: string[] = [];
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
  const sessionOptions: ConstructorParameters<typeof ConversationCall>[0] = {
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
    onCaption: (texts) => {
      captions.push(texts);
    },
    onReplyEnded: (texts, kind, runId) => {
      replyEndings.push({ texts, kind, ...(runId !== undefined ? { runId } : undefined) });
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
    sessionOptions.askBrain = (question, submissionId) => {
      asked.push(question);
      submissions.push(submissionId);
      return askBrain(question);
    };
  }
  const session = new ConversationCall(sessionOptions);

  return {
    session,
    sent,
    errors,
    captions,
    replyEndings,
    asked,
    submissions,
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
export function deviceArrives(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Presses the talk key and waits for the device it opens. The microphone is
 * the developer's, not the call's, so every turn starts with this ask.
 */
export async function holdTurn(context: Harness): Promise<void> {
  context.session.beginTurn();
  await deviceArrives();
}

/** Opens and commits a developer turn, the turn a spoken ask of the brain arrives in. */
export async function armDeveloperTurn(context: Harness): Promise<void> {
  await holdTurn(context);
  context.session.stopListening(true);
}

/** Ends the reply the server was producing, settling the exchange to READY. */
export function settleReply(context: Harness): void {
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
}

/**
 * A developer's turn committed and the reply to it confirmed: the state every
 * question about how a reply ends is asked from.
 */
export async function replyUnderWay(): Promise<Harness> {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  return context;
}

/** The server saying it has finished producing the reply. */
export function generationFinished(context: Harness): void {
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
}

/** The server saying the reply's audio has run out. */
export function serverDrainedTheAudio(context: Harness): void {
  context.emit({
    type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED,
    response_id: "resp-1",
  });
}

/**
 * The meter reporting a silence it has already decided is Luke's and long
 * enough to be an ending — the only ending a call that reports none of its own
 * ever gets.
 */
export function meterWentQuiet(context: Harness): void {
  context.session.reportRemoteAudioIdle();
}

/** One briefing the brain decided, worded about one session, decided a moment ago. */
export function briefingAbout(
  id: string,
  briefing = `Claude Code finished ${id}.`,
): BriefingSpeech {
  return { kind: BRIEFING_SPEECH_KIND, briefing, decidedAt: Date.now() };
}

/** One `ask_brain` call as it sits inside a finished response's output. */
export function askBrainCall(question: string, callId = "call-1"): JsonValue {
  return {
    type: "function_call",
    name: ASK_BRAIN_TOOL.name,
    call_id: callId,
    arguments: JSON.stringify({ question }),
  };
}

/** A `response.done` whose one output is an `ask_brain` call carrying the developer's words. */
export function askBrainDone(
  question: string,
  options: { callId?: string; responseId?: string } = {},
): JsonValue {
  const output = [askBrainCall(question, options.callId)];
  const response =
    options.responseId === undefined ? { output } : { id: options.responseId, output };
  return { type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response };
}

/** The tool outputs sent since `from`, each parsed back out of its item. */
export function toolOutputs(context: Harness, from = 0): ParsedJsonObject[] {
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
export function responseCreates(context: Harness, from = 0): ParsedJsonObject[] {
  return context.sent
    .slice(from)
    .filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE);
}

/** The errors actually shown, past the clearing every connect starts with. */
export function reportedErrors(context: Harness): string[] {
  return context.errors.filter((message): message is string => message !== undefined);
}
