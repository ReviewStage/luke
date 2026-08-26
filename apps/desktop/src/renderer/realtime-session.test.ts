import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APP_SETTING_KIND, type AppGuideSnapshot } from "@sidecar/guide";
import { ISSUE_TRACKER_ID, normalizeTrackedIssue, type TrackedIssue } from "@sidecar/issues";
import {
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  appendConversationEntry,
  CONTEXT_ITEM_KIND,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  inputAudioAppendEvents,
  inputAudioFormatUpdateEvents,
  isCarriedAppAction,
  isCarriedIssueAction,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeConnection,
  type RealtimeStatus,
} from "@sidecar/realtime";
import {
  ATTENTION_DISPOSITION,
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type Session,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { isRecord } from "@sidecar/wire";
import type { JsonValue, ParsedJsonObject } from "@sidecar/wire/testing";
import {
  asMediaStream,
  asPeerConnection,
  type MockDataChannel,
  type MockMediaStream,
  type MockMediaTrack,
  type MockPeerConnection,
  type MockTrackEvent,
  parseClientEvent,
} from "#testing/realtime-fixtures";
import {
  type ActCarrier,
  type AppActionCarrier,
  type IssueActionCarrier,
  quietIsLukesOwn,
  REALTIME_SETTLE_TIMEOUT_MS,
  REMOTE_QUIET_MS,
  RealtimeVoiceSession,
  type SessionActionCarrier,
  VOICE_IDLE_TIMEOUT_MS,
} from "./realtime-session";
import { SpokenNoticeAnnouncer } from "./spoken-notices";

function sessionField(event: ParsedJsonObject | undefined): ParsedJsonObject | undefined {
  if (!event) return undefined;
  const session = event.session;
  return isRecord(session) ? session : undefined;
}

function sessionHasTools(event: ParsedJsonObject): boolean {
  const session = sessionField(event);
  return session !== undefined && Array.isArray(session.tools);
}

function sessionAudioField(event: ParsedJsonObject | undefined): JsonValue | undefined {
  return sessionField(event)?.audio;
}

function toolParameterPropertyNames(tool: ParsedJsonObject | undefined): readonly string[] {
  if (!tool) return [];
  const parameters = tool.parameters;
  if (!isRecord(parameters)) return [];
  const properties = parameters.properties;
  if (!isRecord(properties)) return [];
  return Object.keys(properties);
}

const CONNECTION: RealtimeConnection = {
  value: "ek_test_secret",
  expiresAt: 1_800_000_060_000,
  model: "gpt-realtime-2.1",
  callsUrl: "https://api.openai.com/v1/realtime/calls",
};

/** One transceiver a call declared, as the fixture peer recorded it. */
interface RecordedTransceiver {
  kind: string;
  direction?: string;
}

interface Harness {
  session: RealtimeVoiceSession;
  sent: ParsedJsonObject[];
  errors: (string | undefined)[];
  /** Each caption emission: one text per stacked response, or a clear. */
  captions: (readonly string[] | undefined)[];
  /** The announced session each caption emission carried, by session id. */
  captionSubjects: (string | undefined)[];
  /** The words each ended reply left behind, with its announced subject. */
  replyEndings: { texts: readonly string[]; about: string | undefined }[];
  /** The developer's spoken turns, as the service handed them back. */
  spokenAsks: string[];
  microphoneEnabled: () => boolean;
  microphoneStopped: () => boolean;
  emit: (event: JsonValue) => void;
  emitRaw: (data: JsonValue) => void;
  lukeAudible: () => boolean;
  deliverRemoteTrack: (streams?: readonly object[]) => void;
  provideConnection: () => void;
  setConnectionState: (state: RTCPeerConnectionState) => void;
  closeChannel: () => void;
  requests: { url: string; init: RequestInit }[];
  /** The order the credential and the device were asked for and answered in. */
  calls: string[];
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  /** The transceivers declared instead of tracks, as a speak-only call does. */
  transceivers: RecordedTransceiver[];
  /**
   * The idle retirement, held rather than run: every test connects and few
   * close, so a real ten-minute timer would keep the run alive for ten
   * minutes apiece. Firing one retires it the way the session's re-arm would.
   */
  idleArmed: () => boolean;
  idleDelayMs: () => number | undefined;
  fireIdle: () => void;
  /** Every track handed to the sender, `null` standing for the device let go. */
  replacedTracks: () => (object | null)[];
  /**
   * The press captures the session created, in order. `feed` plays samples
   // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
   * into one as the audio graph would; `stopped` says the session let go.
   */
  pressCaptures: { stopped: boolean; feed: (samples: readonly number[]) => void }[];
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  /** Makes the next device request refuse, as a vanished microphone would. */
  failMicrophone: () => void;
  /** Holds device opens in flight until `ungateMicrophone` lets them land. */
  gateMicrophone: () => void;
  ungateMicrophone: () => void;
}

interface HeldTimer {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
}

function observedSession(
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): Session {
  return normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId,
      title: "Claude Code: checkout-service",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_800_000_000_000,
      ...overrides,
    },
  );
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
    carryAct?: ActCarrier;
    carryAction?: SessionActionCarrier;
    carryAppAction?: AppActionCarrier;
    carryIssueAction?: IssueActionCarrier;
    idleTimeoutMs?: number;
    captureSessionSync?: boolean;
    /** Lets a test ride the status edges, the way the announcer does. */
    onStatus?: (status: RealtimeStatus) => void;
    /** Lets a test see what the element would be handed to play. */
    onRemoteStream?: (stream: MediaStream | undefined) => void;
    /**
     * Mimics the caller's history: an ended reply's words are written back
     * into the session as a conversation update, the way the hook records
     * them. What the write-back does to a call being torn down is exactly
     * what the tests using this are about.
     */
    writeBackOnReplyEnded?: boolean;
  } = {},
): Harness {
  const timers: HeldTimer[] = [];
  const armedTimer = (): HeldTimer | undefined => timers.findLast((timer) => !timer.cancelled);
  const fireTimer = (): void => {
    const timer = armedTimer();
    if (!timer) return;
    // A fired timer is spent: only a re-arm by the session makes a new one.
    timer.cancelled = true;
    timer.callback();
  };
  const sent: ParsedJsonObject[] = [];
  const errors: (string | undefined)[] = [];
  const captions: (readonly string[] | undefined)[] = [];
  const captionSubjects: (string | undefined)[] = [];
  const replyEndings: { texts: readonly string[]; about: string | undefined }[] = [];
  const spokenAsks: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
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

  const channel: MockDataChannel = {
    readyState: options.channelOpensImmediately === false ? "connecting" : "open",
    send: (payload: string) => {
      const event = parseClientEvent(payload);
      const isSessionSync =
        event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionHasTools(event);
      if (options.captureSessionSync || !isSessionSync) sent.push(event);
    },
    close: () => {
      channel.readyState = "closed";
      queueMicrotask(() => channel.onclose?.());
    },
  };

  const remoteTrack = { enabled: true };
  const transceivers: RecordedTransceiver[] = [];
  const replacedTracks: (MockMediaTrack | null)[] = [];
  const peer: MockPeerConnection = {
    localDescription: { type: "offer", sdp: "v=0 local" },
    connectionState: "connected",
    addTransceiver: (kind: string, init?: { direction?: string }) => {
      const entry: RecordedTransceiver = { kind };
      if (init?.direction) {
        entry.direction = init.direction;
      }
      transceivers.push(entry);
      return {
        sender: {
          replaceTrack: async (next: MockMediaTrack | null) => {
            replacedTracks.push(next);
          },
        },
      };
    },
    createDataChannel: () => {
      channel.readyState = options.channelOpensImmediately === false ? "connecting" : "open";
      return channel;
    },
    createOffer: async () => ({ type: "offer", sdp: "v=0 local" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
    close: () => {
      peer.connectionState = "closed";
      queueMicrotask(() => peer.onconnectionstatechange?.());
    },
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
    createPeerConnection: () => asPeerConnection(peer),
    exchangeDescription: async (url, init) => {
      requests.push({ url, init });
      if (options.sdpDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.sdpDelayMs));
      }
      return options.sdpResponse ?? new Response("v=0 remote", { status: 200 });
    },
    schedule: (callback, delayMs) => {
      const timer: HeldTimer = { callback, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      // SAFETY: Cancelled timer handle matches the HeldTimer shape stored by the harness.
      (timer as HeldTimer).cancelled = true;
    },
    onStatus: (status) => options.onStatus?.(status),
    onLocalStream: () => undefined,
    onRemoteStream: (stream) => options.onRemoteStream?.(stream),
    onError: (message) => errors.push(message),
    onCaption: (texts, about) => {
      captions.push(texts);
      captionSubjects.push(about?.providerSessionId);
    },
    onReplyEnded: (texts, about) => {
      replyEndings.push({ texts, about: about?.providerSessionId });
      if (options.writeBackOnReplyEnded) {
        session.updateConversation(
          appendConversationEntry([], {
            kind: CONVERSATION_ENTRY_KIND.REPLY,
            words: texts.join(" "),
          }),
        );
      }
    },
    onSpokenAsk: (transcript) => {
      spokenAsks.push(transcript);
    },
  };
  if (options.connectTimeoutMs !== undefined) {
    sessionOptions.connectTimeoutMs = options.connectTimeoutMs;
  }
  if (options.now) {
    sessionOptions.now = options.now;
  }
  if (options.idleTimeoutMs !== undefined) {
    sessionOptions.idleTimeoutMs = options.idleTimeoutMs;
  }
  if (options.carryAct) {
    sessionOptions.carryAct = options.carryAct;
  } else if (options.carryAction || options.carryAppAction || options.carryIssueAction) {
    sessionOptions.carryAct = ({ act }) => {
      if (isCarriedAppAction(act)) {
        return options.carryAppAction?.(act) ?? Promise.resolve({ status: "rejected" });
      }
      if (isCarriedIssueAction(act)) {
        return options.carryIssueAction?.(act) ?? Promise.resolve({ status: "rejected" });
      }
      return options.carryAction?.(act) ?? Promise.resolve({ status: "rejected" });
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
    spokenAsks,
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
      channel.onmessage?.({ data: JSON.stringify(event) });
    },
    emitRaw: (data) => {
      channel.onmessage?.({ data });
    },
    setConnectionState: (state) => {
      peer.connectionState = state;
      peer.onconnectionstatechange?.();
    },
    closeChannel: () => {
      channel.readyState = "closed";
      channel.onclose?.();
    },
    requests,
    calls,
    idleArmed: () => armedTimer() !== undefined,
    idleDelayMs: () => armedTimer()?.delayMs,
    fireIdle: () => {
      fireTimer();
    },
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
    transceivers,
    pressCaptures,
  };
}

const CONVERSATION_ITEM_DELETE = REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_DELETE;

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

/** Ends the reply the server was producing, settling the exchange to READY. */
function settleReply(context: Harness): void {
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
}

/** The words one context item carries, or nothing when the event is not one. */
function itemText(event: ParsedJsonObject | undefined): string {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const item = event?.item as { content?: { text?: string }[] } | undefined;
  return item?.content?.[0]?.text ?? "";
}

/** The context items of one kind that were sent, named by their own label. */
function contextItems(context: Harness, label: string, from = 0): ParsedJsonObject[] {
  return context.sent
    .slice(from)
    .filter(
      (event) =>
        event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE &&
        itemText(event).startsWith(label),
    );
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
  // SAFETY: Fixture headers map matches the string header shape the fake records.
  const headers = request?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${CONNECTION.value}`);
  assert.equal(headers["content-type"], "application/sdp");
  assert.equal(request?.init.body, "v=0 local");
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
  assert.equal(context.replacedTracks().at(-1), null);
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

test("a proactive update is spoken once the call is open", async () => {
  const context = harness();
  const speech = {
    providerId: "claude-code",
    providerSessionId: "session-a",
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    source: ATTENTION_SPEECH_SOURCE.EVALUATOR,
    summary: "Claude Code is waiting on you in checkout-service.",
    decidedAt: 1_800_000_000_000,
  };

  // Nothing is spoken before there is a call to speak over.
  assert.equal(context.session.speak(speech), false);

  await context.session.connect();
  assert.equal(context.session.speak(speech), true);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The sentence is handed over as a message and the reply asked for after it,
  // so the request cannot arrive before the words it is meant to read.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
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
  // The delivery waits a beat for exactly this: the caller re-feeds the
  // roster right after connect resolves, and the held words' reply must be
  // answered from that context rather than from none.
  context.session.updateSessions([observedSession("session-1")]);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  await deviceArrives();

  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.turnPending, false);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.SESSION_UPDATE,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_APPEND,
      REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
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

/** A proactive update on the announcer's terms, decided a moment ago. */
function announcedFinish(id: string): AttentionSpeech {
  return {
    providerId: "claude-code",
    providerSessionId: id,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source: ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST,
    summary: `${id} finished.`,
    decidedAt: Date.now(),
  };
}

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

  // The announcement that queued behind the reply is refused rather than
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // sent: the create it would open is the one the service refuses as a
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // conversation already in progress, surfacing the refusal as a voice error
  // with the notice lost behind it.
  assert.equal(context.session.speak(announcedFinish("session-a")), false);
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    1,
  );

  // The server concluding the reply is what ends the turn — the drain's
  // deferred ending lands with the done — and only then is the next reply
  // welcome.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE, response: { id: "resp-1" } });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  assert.equal(context.session.speak(announcedFinish("session-a")), true);
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

test("an announcement queued mid-reply waits out the server's own ending", async () => {
  // The reported shape of the fault, whole: Luke is reading one announcement
  // out on his own call when another agent finishes. The second announcement
  // must wait for the server to conclude the first reply — not for the audio
  // alone — or its create collides with the active response.
  let announcer: SpokenNoticeAnnouncer | undefined;
  const context = harness({ onStatus: (status) => announcer?.onStatus(status) });
  const timers: (() => void)[] = [];
  announcer = new SpokenNoticeAnnouncer({
    session: () => context.session,
    schedule: (callback) => {
      timers.push(callback);
      return timers.length - 1;
    },
    cancel: () => undefined,
  });

  announcer.enqueue([announcedFinish("session-a")]);
  // The call the announcer opens for itself is a handshake away.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The second agent finishes mid-reply, and then the first reply's audio
  // drains before its done arrives.
  announcer.enqueue([announcedFinish("session-b")]);
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  // One reply asked for so far: the drain freed nothing, so the READY edge
  // the announcer rides has not fired into the server's open response.
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
  const spoken = context.session.speak(announcedFinish("session-a"));
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

test("an opened call synchronizes the local build's tool schema", async () => {
  const context = harness({ captureSessionSync: true });
  await context.session.connect();

  const update = context.sent.find(
    (event) => event.type === REALTIME_CLIENT_EVENT.SESSION_UPDATE && sessionHasTools(event),
  );
  const tools = sessionField(update)?.tools;
  const toolList = Array.isArray(tools) ? tools.filter(isRecord) : [];
  const creation = toolList.find((tool) => tool.name === "create_workspace");
  assert.deepEqual(toolParameterPropertyNames(creation).includes("agent"), true);
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

test("the conversation is told which sessions Luke can see, at the turn that reads them", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateSessions([
    observedSession("session-a", { status: SESSION_STATUS.WAITING, recap: "Waiting on input." }),
  ]);

  // Nothing yet: a roster nobody has asked about is an answer waiting to be
  // given, not an item to keep in the conversation.
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  await armDeveloperTurn(context);

  const item = context.sent.find(
    (event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
  );
  assert.ok(item);
  const text = JSON.stringify(item);
  assert.ok(text.includes("Claude Code"));
  assert.ok(text.includes("waiting"));
  assert.ok(text.includes("Waiting on input."));
  // And it goes in ahead of the turn it is answering, not after it.
  const rosterIndex = context.sent.indexOf(item);
  const commitIndex = context.sent.findIndex(
    (event) => event.type === REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
  );
  assert.ok(rosterIndex >= 0 && rosterIndex < commitIndex);
});

test("a roster that churns between turns is only ever said once", async () => {
  const context = harness();
  await context.session.connect();

  // Five seconds apart, all day: the poll sees a working session tick over and
  // the rendered roster differs every time. None of it is worth an item until
  // somebody asks — otherwise the developer's own earlier turns are what gets
  // evicted to make room for a status that has already changed again.
  for (const recap of ["Reading files.", "Editing.", "Running tests.", "Waiting on input."]) {
    context.session.updateSessions([observedSession("session-a", { recap })]);
  }
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);

  await armDeveloperTurn(context);

  const rosters = contextItems(context, "[observed session status");
  assert.equal(rosters.length, 1);
  // The newest one, not the first: the turn is answered from what is true now.
  assert.match(itemText(rosters[0]), /Waiting on input\./);
});

test("a fresh roster replaces the item the last one occupied", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateSessions([observedSession("session-a", { recap: "Editing." })]);
  await armDeveloperTurn(context);
  const first = context.session.liveContextItemIds.get(CONTEXT_ITEM_KIND.SESSIONS);
  assert.ok(first);

  context.session.updateSessions([observedSession("session-a", { recap: "Waiting on input." })]);
  context.session.stopSpeaking();
  const sentBefore = context.sent.length;
  await armDeveloperTurn(context);

  // The old item is deleted, then the new one created — in that order, on a
  // channel that keeps it, so the conversation never holds two rosters.
  const events = context.sent.slice(sentBefore);
  const deleteIndex = events.findIndex((event) => event.type === CONVERSATION_ITEM_DELETE);
  const createIndex = events.findIndex(
    (event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
  );
  assert.ok(deleteIndex >= 0 && deleteIndex < createIndex);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  assert.equal((events[deleteIndex] as { item_id?: string }).item_id, first);

  const second = context.session.liveContextItemIds.get(CONTEXT_ITEM_KIND.SESSIONS);
  assert.ok(second);
  assert.notEqual(second, first);
});

test("a supersede the server refuses is this call's own business", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateSessions([observedSession("session-a", { recap: "Editing." })]);
  await armDeveloperTurn(context);
  const superseded = context.session.liveContextItemIds.get(CONTEXT_ITEM_KIND.SESSIONS);

  context.session.updateSessions([observedSession("session-a", { recap: "Waiting." })]);
  context.session.stopSpeaking();
  await armDeveloperTurn(context);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const supersede = context.sent.findLast((event) => event.type === CONVERSATION_ITEM_DELETE) as {
    event_id?: string;
  };

  // The item was already gone — evicted at the window's edge is how that
  // happens — so the delete is answered with an error naming the event we sent.
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // It is not a fault of the developer's and must not be shown as one, nor end
  // the reply they are listening to.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "invalid_request_error",
      message: `Item with id '${superseded}' not found.`,
      event_id: supersede.event_id,
    },
  });

  assert.deepEqual(reportedErrors(context), []);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("an error that is not ours is still reported and still ends the turn", async () => {
  const context = harness();
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a")]);
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: { type: "invalid_request_error", message: "The commit held no audio." },
  });

  assert.deepEqual(reportedErrors(context), ["The commit held no audio."]);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("an unchanged session roster is not resent", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateSessions([observedSession("session-a")]);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  // The same roster again, and another turn: there is nothing new to say, so
  // nothing is said and the item already standing keeps its place.
  context.session.updateSessions([observedSession("session-a")]);
  context.session.stopSpeaking();
  await armDeveloperTurn(context);

  assert.deepEqual(contextItems(context, "[observed session status", sentBefore), []);
  assert.equal(
    context.sent.slice(sentBefore).some((event) => event.type === CONVERSATION_ITEM_DELETE),
    false,
  );
});

test("a stale session aging across clock ticks does not resend the roster", async (t) => {
  const context = harness();
  await context.session.connect();
  // Six minutes past the fixture's observedAt, inside the minutes bucket.
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_360_000 });

  context.session.updateSessions([observedSession("session-a")]);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  // Two minutes pass and the same roster is reported against the fresh clock.
  // The bucketed age phrase holds still, so the item keeps its place and the
  // conversation's cached prefix survives the tick.
  t.mock.timers.tick(2 * 60_000);
  context.session.updateSessions([observedSession("session-a")]);
  context.session.stopSpeaking();
  await armDeveloperTurn(context);

  assert.deepEqual(contextItems(context, "[observed session status", sentBefore), []);
});

function conversationEntries(
  ...entries: readonly ConversationEntry[]
): readonly ConversationEntry[] {
  let history: readonly ConversationEntry[] = [];
  for (const entry of entries) history = appendConversationEntry(history, entry);
  return history;
}

test("the history travels with the roster, carrying the identities its lines named", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateSessions([
    observedSession("session-a"),
    observedSession("session-b", { title: "Claude Code: payments" }),
  ]);
  // The announcement this line records named the session only by title — and
  // was often read out on a call this one replaced. The history is what
  // carries the words and the identity into the turn that says "open that
  // chat".
  context.session.updateConversation(
    conversationEntries({
      kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
      words: "Claude Code finished payments.",
      identity: { providerId: "claude-code", providerSessionId: "session-b" },
    }),
  );
  // Remembered, not sent: the words go in at the turn that reads them.
  assert.deepEqual<ParsedJsonObject[]>(context.sent, []);

  await armDeveloperTurn(context);

  const items = contextItems(context, "[recent conversation");
  assert.equal(items.length, 1);
  assert.match(itemText(items[0]), /Luke announced: "Claude Code finished payments\."/);
  assert.match(itemText(items[0]), /provider_id=claude-code provider_session_id=session-b/);
  // After the roster it is rendered against, on a channel that keeps order.
  const rosterIndex = context.sent.findIndex((event) =>
    itemText(event).startsWith("[observed session status"),
  );
  assert.ok(rosterIndex >= 0 && rosterIndex < context.sent.indexOf(items[0] ?? {}));
});

test("an empty history says nothing at all", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateSessions([observedSession("session-a")]);
  context.session.updateConversation([]);
  await armDeveloperTurn(context);

  assert.deepEqual(contextItems(context, "[recent conversation"), []);
});

test("the history is rendered from the roster as it now stands", async () => {
  const context = harness();
  await context.session.connect();

  const history = conversationEntries({
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Claude Code finished checkout-service.",
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
  });
  context.session.updateSessions([observedSession("session-a")]);
  context.session.updateConversation(history);
  await armDeveloperTurn(context);

  // The words are history and keep their line; the identity is an offer to a
  // tool call, and a session the roster no longer shows is one no call may
  // name — so the line lets go of it rather than steering "that chat" toward
  // a certain refusal.
  context.session.updateSessions([]);
  context.session.stopSpeaking();
  const sentBefore = context.sent.length;
  await armDeveloperTurn(context);

  const items = contextItems(context, "[recent conversation", sentBefore);
  assert.equal(items.length, 1);
  assert.match(itemText(items[0]), /finished checkout-service/);
  assert.doesNotMatch(itemText(items[0]), /provider_session_id=session-a/);
});

test("a fresh history line replaces the item before it", async () => {
  const context = harness();
  await context.session.connect();

  const first = conversationEntries({
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Claude Code finished checkout-service.",
  });
  context.session.updateConversation(first);
  await armDeveloperTurn(context);
  const firstItem = context.session.liveContextItemIds.get(CONTEXT_ITEM_KIND.CONVERSATION);
  assert.ok(firstItem);

  context.session.stopSpeaking();
  context.session.updateConversation(
    appendConversationEntry(first, {
      kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
      words: "Codex failed in payments.",
    }),
  );
  const sentBefore = context.sent.length;
  await armDeveloperTurn(context);

  // One live item per kind: the old record is deleted before the new goes in,
  // so the conversation never holds two histories.
  assert.equal(
    context.sent.slice(sentBefore).some(
      (event) =>
        event.type === CONVERSATION_ITEM_DELETE &&
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        (event as { item_id?: string }).item_id === firstItem,
    ),
    true,
  );
  const items = contextItems(context, "[recent conversation", sentBefore);
  assert.equal(items.length, 1);
  assert.match(itemText(items[0]), /finished checkout-service/);
  assert.match(itemText(items[0]), /failed in payments/);
  assert.notEqual(
    context.session.liveContextItemIds.get(CONTEXT_ITEM_KIND.CONVERSATION),
    firstItem,
  );

  // The same history again is not news: nothing is resent.
  context.session.stopSpeaking();
  const repeatBefore = context.sent.length;
  await armDeveloperTurn(context);
  assert.deepEqual(contextItems(context, "[recent conversation", repeatBefore), []);
});

test("a reply ending at teardown writes nothing back into the retired call", async () => {
  const context = harness({ writeBackOnReplyEnded: true });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a")]);
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
  // history keeps them — but the write-back that handover makes must land
  // before the stores empty and leave with them, or the retired call would
  // carry a pending item, rendered against an emptied roster, into a call
  // whose caller has said nothing yet.
  context.closeChannel();
  assert.equal(context.replyEndings.length, 1);

  await context.session.connect();
  const sentBefore = context.sent.length;
  await armDeveloperTurn(context);

  assert.deepEqual(contextItems(context, "[recent conversation", sentBefore), []);
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

  assert.deepEqual(context.replyEndings, [
    { texts: ["The checkout work is done."], about: undefined },
  ]);
});

test("an announcement's reply hands its subject back with the words", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });

  context.session.speak({
    providerId: "claude-code",
    providerSessionId: "session-a",
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source: ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST,
    summary: "Claude Code finished checkout-service.",
    decidedAt: 1_800_000_000_000,
  });
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

  // The subject rides along so the caller can tell an announcement's reply —
  // already recorded from the update that decided it — from a conversation
  // reply that still needs a line.
  assert.deepEqual(context.replyEndings, [
    { texts: ["Claude Code finished checkout-service."], about: "session-a" },
  ]);
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
  const speech = {
    providerId: "claude-code",
    providerSessionId: "session-a",
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    source: ATTENTION_SPEECH_SOURCE.EVALUATOR,
    summary: "Claude Code is waiting on you in checkout-service.",
    decidedAt: 1_800_000_000_000,
  };

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
  // end can measure past the audio itself. The refusal means every word was
  // heard and the record is already right — nothing the developer can or
  // should act on.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: {
      type: "invalid_request_error",
      message: "Audio content of 1500ms is already shorter than 2000ms",
      event_id: truncate?.event_id,
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
  const context = harness({ now: () => clock, carryAction: async () => ({ status: "sent" }) });
  await context.session.connect();
  context.deliverRemoteTrack();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "spoken" } });
  context.session.reportRemoteAudioActive();

  // The reply calls a tool, its follow-up is asked for, and only then does the
  // spoken half's buffer report itself empty: the drain is the old reply's,
  // arriving after the follow-up already owns the turn.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
      output: [
        {
          type: "function_call",
          name: "send_session_message",
          call_id: "call-1",
          arguments:
            '{"provider_id":"claude-code","provider_session_id":"session-a","text":"run the tests"}',
        },
      ],
    },
  });
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
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.deliverRemoteTrack();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  // The stop lands in the gap between asking for the reply and the server
  // confirming it: the cancel and the confirmation cross on the wire.
  await armDeveloperTurn(context);
  assert.equal(context.session.stopSpeaking(), true);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });

  // The late confirmation is the cancelled reply's own. Adopting it would
  // re-open the track over the quiet just asked for.
  assert.equal(context.lukeAudible(), false);
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  // And its finished form must not act: the turn its arming belonged to
  // ended with the stop, however armed it was when the reply was asked for.
  const before = context.sent.length;
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-a",
      output: [
        {
          type: "function_call",
          name: "send_session_message",
          call_id: "call-late",
          arguments:
            '{"provider_id":"claude-code","provider_session_id":"session-a","text":"do it anyway"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, []);
  const events = context.sent.slice(before);
  const output = events.find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (
      JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
        status?: string;
      }
    ).status,
    "rejected",
  );
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));

  // The next reply the developer actually asks for is heard again.
  context.session.sendText("what needs me?");
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-b" } });
  assert.equal(context.lukeAudible(), true);
});

test("a stopped reply's tool follow-up stands down instead of speaking over the quiet", async () => {
  let resolveCarry: ((outcome: ParsedJsonObject) => void) | undefined;
  const context = harness({
    carryAction: () =>
      new Promise((resolve) => {
        resolveCarry = resolve;
      }),
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-a",
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
  assert.ok(resolveCarry, "the write is under way when the stop lands");

  // The developer asks for quiet while the write is still in flight.
  assert.equal(context.session.stopSpeaking(), true);
  const before = context.sent.length;
  resolveCarry?.({ status: "accepted" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The outcome is still delivered as an item, so the next turn has it — but
  // no reply opens to voice it: the quiet just asked for holds.
  const events = context.sent.slice(before);
  assert.ok(
    events.some(
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    ),
  );
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
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
/** Opens and commits a developer turn, which is the only turn a tool may run in. */
async function armDeveloperTurn(context: Harness): Promise<void> {
  await holdTurn(context);
  context.session.stopListening(true);
}

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

test("a typed ask can carry a tool call, because the developer opened the turn", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  // The turn is opened by typing rather than by the talk key: the two arm the
  // gate on the same terms, because both are the developer's own ask.
  context.session.sendText("ask claude code to add tests");

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

  assert.deepEqual(carried, [
    {
      kind: "message",
      identity: { providerId: "claude-code", providerSessionId: "session-a" },
      text: "add tests",
    },
  ]);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The outcome is voiced, exactly as a spoken ask's would be.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
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

test("a cancelled reply's late finish cannot act in the turn that replaced it", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  // A spoken turn opens reply A, and the server confirms it by name.
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-a" } });
  // The developer types over it, opening a new armed turn.
  assert.equal(context.session.sendText("never mind — what needs me?"), true);
  const sentBefore = context.sent.length;

  // Reply A's finished form arrives late — the server had completed it before
  // the cancel landed — carrying the very call the developer interrupted.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-a",
      output: [
        {
          type: "function_call",
          name: "send_session_message",
          call_id: "call-stale",
          arguments:
            '{"provider_id":"claude-code","provider_session_id":"session-a","text":"do it anyway"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Nothing was carried: the session takes messages and the identity is real,
  // so only the freshness of the reply stands between the call and the write —
  // and it holds, however armed the turn that superseded it is.
  assert.deepEqual(carried, []);
  const events = context.sent.slice(sentBefore);
  const output = events.find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (
      JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
        status?: string;
      }
    ).status,
    "rejected",
  );
  // No reply was opened to voice the refusal, and the new turn is still under way.
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // The reply the typed ask actually asked for still acts in full.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-b" } });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-b",
      output: [
        {
          type: "function_call",
          name: "send_session_message",
          call_id: "call-fresh",
          arguments:
            '{"provider_id":"claude-code","provider_session_id":"session-a","text":"status?"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(carried.length, 1);
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

test("a spoken ask is carried through the carrier and its outcome is voiced", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  // The tool call arrives inside a turn the developer opened by speaking.
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

  assert.deepEqual(carried, [
    {
      kind: "message",
      identity: { providerId: "claude-code", providerSessionId: "session-a" },
      text: "add tests",
    },
  ]);
  const followUp = context.sent.slice(sentBefore);
  const output = followUp.find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  assert.equal((output?.item as { output?: string } | undefined)?.output, '{"status":"accepted"}');
  assert.equal(
    followUp.at(-1)?.type,
    REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    "the outcome is voiced by the reply that follows",
  );
  // The turn never ended: the reply resumes over the outcome.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a session carrier that throws is refused with the error that caused it", async () => {
  const context = harness({
    carryAction: async () => {
      throw new Error("Claude Code could not be reached.");
    },
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
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

  const output = context.sent.slice(sentBefore).find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const parsed = JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
    status?: string;
    reason?: string;
  };
  assert.equal(parsed.status, "rejected");
  assert.equal(parsed.reason, "Claude Code could not be reached.");
});

test("a spoken ask to open a session is carried, and one with no address is refused", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "opened" };
    },
  });
  await context.session.connect();
  // One session reported an address; the other reported none and so has
  // nowhere to be opened, however real its identity is.
  context.session.updateSessions([
    observedSession("session-a", { detail: { link: "https://claude.ai/session/session-a" } }),
    observedSession("session-b"),
  ]);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "open_session",
          call_id: "call-1",
          arguments: '{"provider_id":"claude-code","provider_session_id":"session-a"}',
        },
        {
          type: "function_call",
          name: "open_session",
          call_id: "call-2",
          arguments: '{"provider_id":"claude-code","provider_session_id":"session-b"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The carried action names the session, never its address: the main process
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // reads the link back out of its own registry, the same as a pressed row.
  assert.deepEqual(carried, [
    { kind: "open", identity: { providerId: "claude-code", providerSessionId: "session-a" } },
  ]);
  const outputs = context.sent.slice(sentBefore).filter(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  const statuses = outputs.map(
    (event) =>
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (
        JSON.parse((event.item as { output?: string } | undefined)?.output ?? "{}") as {
          status?: string;
        }
      ).status,
  );
  assert.deepEqual(statuses, ["opened", "rejected"]);
});

test("a spoken ask for a new workspace is carried, and an unlisted project is refused", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  const project = {
    providerId: "conductor",
    providerName: "Conductor",
    providerProjectId: "proj-1",
    repository: "luke",
    taskSupport: "optional",
  } as const;
  context.session.updateWorkspaceProjects([project]);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The projects travel as context the way the roster does, and an identical
  // list is not resent.
  context.session.updateWorkspaceProjects([project]);
  await armDeveloperTurn(context);
  assert.equal(contextItems(context, "[workspace projects").length, 1);

  // A changed default is news the way a changed list is: the context is
  // resent, now saying by id where a nameless ask goes.
  const sentBeforeDefault = context.sent.length;
  context.session.updateWorkspaceProjects([project], "conductor");
  context.session.stopSpeaking();
  await armDeveloperTurn(context);
  const chosen = contextItems(context, "[workspace projects", sentBeforeDefault);
  assert.equal(chosen.length, 1);
  const chosenItem = chosen[0];
  assert.ok(chosenItem);
  assert.match(
    itemText(chosenItem),
    /names no provider creates in Conductor \[provider_id=conductor\]/,
  );

  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "create_workspace",
          call_id: "call-1",
          arguments:
            '{"provider_id":"conductor","project_id":"proj-1","name":"fix the panel","task":"wire the XYZ feature"}',
        },
        {
          type: "function_call",
          name: "create_workspace",
          call_id: "call-2",
          arguments: '{"provider_id":"conductor","project_id":"proj-unlisted"}',
        },
        {
          type: "function_call",
          name: "create_workspace",
          call_id: "call-3",
          arguments:
            '{"provider_id":"conductor","project_id":"proj-1","model":"Fable 5","effort":"max"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Only the listed project reaches the carrier; the unlisted one is refused
  // before any bridge call exists. A model named for one creation arrives
  // resolved to the wire pairing the build's own table documents.
  assert.deepEqual(carried, [
    {
      kind: "create-workspace",
      providerId: "conductor",
      providerProjectId: "proj-1",
      name: "fix the panel",
      task: "wire the XYZ feature",
    },
    {
      kind: "create-workspace",
      providerId: "conductor",
      providerProjectId: "proj-1",
      agentSelection: { agent: "claude", model: "fable-5", effort: "max" },
    },
  ]);
  const outputs = context.sent.slice(sentBefore).filter(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  const statuses = outputs.map(
    (event) =>
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (
        JSON.parse((event.item as { output?: string } | undefined)?.output ?? "{}") as {
          status?: string;
        }
      ).status,
  );
  assert.deepEqual(statuses, ["accepted", "rejected", "accepted"]);
});

test("a Superset workspace requires an observed host and agent", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateWorkspaceProjects([
    {
      providerId: "superset",
      providerName: "Superset",
      providerProjectId: "project-1",
      providerTargetId: "host-1",
      targetName: "Build Mac",
      repository: "Luke",
      taskSupport: "required",
      spawnableAgents: ["codex"],
    },
  ]);
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "create_workspace",
          call_id: "call-superset",
          arguments:
            '{"provider_id":"superset","project_id":"project-1","target_id":"host-1","agent":"codex","task":"Fix the panel"}',
        },
        {
          type: "function_call",
          name: "create_workspace",
          call_id: "call-stale",
          arguments:
            '{"provider_id":"superset","project_id":"project-1","target_id":"host-old","agent":"codex","task":"Fix the panel"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    {
      kind: "create-workspace",
      providerId: "superset",
      providerProjectId: "project-1",
      providerTargetId: "host-1",
      agent: "codex",
      task: "Fix the panel",
    },
  ]);
});

test("a sole Superset project resolves when the model omits its routing ids", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateWorkspaceProjects([
    {
      providerId: "superset",
      providerName: "Superset",
      providerProjectId: "project-1",
      providerTargetId: "local",
      targetName: "This Mac",
      repository: "Luke",
      taskSupport: "required",
      spawnableAgents: ["codex"],
    },
  ]);
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "create_workspace",
          call_id: "call-superset-implicit-project",
          arguments: '{"provider_id":"superset","agent":"codex","task":"Fix the panel"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    {
      kind: "create-workspace",
      providerId: "superset",
      providerProjectId: "project-1",
      providerTargetId: "local",
      agent: "codex",
      task: "Fix the panel",
    },
  ]);
});

test("a Superset agent display name resolves to its advertised preset id", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateWorkspaceProjects([
    {
      providerId: "superset",
      providerName: "Superset",
      providerProjectId: "project-1",
      providerTargetId: "local",
      targetName: "This Mac",
      repository: "Luke",
      taskSupport: "required",
      spawnableAgents: ["claude", "codex"],
    },
  ]);
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "create_workspace",
          call_id: "call-superset-display-agent",
          arguments: '{"provider_id":"superset","agent":"Codex","task":"Fix the panel"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    {
      kind: "create-workspace",
      providerId: "superset",
      providerProjectId: "project-1",
      providerTargetId: "local",
      agent: "codex",
      task: "Fix the panel",
    },
  ]);
});

test("a spoken ask to add an agent is carried, and an unlisted kind is refused", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateSessions([
    observedSession("chat-1", { spawnableAgents: ["claude", "codex", "cursor"] }),
  ]);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "add_workspace_agent",
          call_id: "call-1",
          arguments:
            '{"provider_id":"claude-code","provider_session_id":"chat-1","agent":"codex","task":"Build the XYZ feature"}',
        },
        {
          type: "function_call",
          name: "add_workspace_agent",
          call_id: "call-2",
          arguments: '{"provider_id":"claude-code","provider_session_id":"chat-1","agent":"devin"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Only a kind the roster entry listed reaches the carrier; the other is
  // refused before any bridge call exists.
  assert.deepEqual(carried, [
    {
      kind: "add-agent",
      identity: { providerId: "claude-code", providerSessionId: "chat-1" },
      agent: "codex",
      task: "Build the XYZ feature",
    },
  ]);
  const outputs = context.sent.slice(sentBefore).filter(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  const statuses = outputs.map(
    (event) =>
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (
        JSON.parse((event.item as { output?: string } | undefined)?.output ?? "{}") as {
          status?: string;
        }
      ).status,
  );
  assert.deepEqual(statuses, ["accepted", "rejected"]);
});

test("a tool call outside the roster is refused before any carrier runs", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  // The roster names one session that takes nothing.
  context.session.updateSessions([observedSession("session-a")]);
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
            '{"provider_id":"claude-code","provider_session_id":"session-unknown","text":"hi"}',
        },
        {
          type: "function_call",
          name: "send_session_message",
          call_id: "call-2",
          arguments: '{"provider_id":"claude-code","provider_session_id":"session-a","text":"hi"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Nothing was carried: one call named a session Luke was never shown, the
  // other named one that advertised nothing. Both were answered anyway, so the
  // model is never left waiting on a call that will not return.
  assert.deepEqual(carried, []);
  const outputs = context.sent.slice(sentBefore).filter(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(outputs.length, 2);
  for (const event of outputs) {
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    const raw = (event.item as { output?: string } | undefined)?.output ?? "{}";
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    assert.equal((JSON.parse(raw) as { status?: string }).status, "rejected");
  }
});

test("a tool call outside a turn the developer opened cannot act", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  // No developer turn is opened: the call arrives on a turn Luke was not asked
  // to act in — the shape a summary-driven injection would take.
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

  // The session takes messages and the identity is real, so only the turn gate
  // stands between the call and the write — and it holds.
  assert.deepEqual(carried, []);
  const events = context.sent.slice(sentBefore);
  const output = events.find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (
      JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
        status?: string;
      }
    ).status,
    "rejected",
  );
  // The call is answered so the model is not left waiting, but the turn opens
  // no reply: a turn Luke was not asked to act in must not talk on either.
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
});

test("a tool outcome is not spoken over a turn the developer has taken", async () => {
  let resolveWrite: ((output: ParsedJsonObject) => void) | undefined;
  const context = harness({
    carryAction: () =>
      new Promise<ParsedJsonObject>((resolve) => {
        resolveWrite = resolve;
      }),
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
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
  // Let the answer reach the point where it is awaiting the write.
  await Promise.resolve();
  // The developer takes the turn while the write is still in flight.
  context.session.beginTurn();
  await deviceArrives();
  resolveWrite?.({ status: "accepted" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const events = context.sent.slice(sentBefore);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The outcome was still delivered as an item, so the next turn has it...
  assert.ok(
    events.some(
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    ),
  );
  // ...but no reply was opened to voice it over the microphone now open.
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("a drained tool reply holds the turn for the follow-up it owes", async () => {
  let resolveWrite: ((output: ParsedJsonObject) => void) | undefined;
  const context = harness({
    carryAction: () =>
      new Promise<ParsedJsonObject>((resolve) => {
        resolveWrite = resolve;
      }),
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The spoken half's audio drains before the done that carries the calls.
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
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
  await Promise.resolve();

  // The turn holds through the write: the READY an ending here would offer is
  // the edge the announcer rides, and a reply taken there would abandon the
  // follow-up that is the outcome's only voice.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(announcedFinish("session-b")), false);

  resolveWrite?.({ status: "accepted" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up opened: the outcome is voiced rather than abandoned.
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    2,
  );
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("the write's hold gets a clock of its own, not the drain's leftovers", async (t) => {
  const context = harness({
    carryAction: () => new Promise<ParsedJsonObject>(() => undefined),
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The drain arms a backstop for the missing done, and nearly spends it.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS - 1);

  // The done it was watching for arrives, carrying calls: the hold that
  // follows is the write's, not the tail of the drain's clock.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
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
  await Promise.resolve();

  // The drain's leftover second must not cut the hold mid-write...
  t.mock.timers.tick(1);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // ...while a write that hangs past a whole window still meets the backstop:
  // a turn that never ends is worse than one that ends early.
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("audio draining mid-write holds the turn the same way", async () => {
  let resolveWrite: ((output: ParsedJsonObject) => void) | undefined;
  const context = harness({
    carryAction: () =>
      new Promise<ParsedJsonObject>((resolve) => {
        resolveWrite = resolve;
      }),
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The ordinary order: the done carrying the calls lands while the spoken
  // half is still audible, and the audio drains during the write.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
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
  await Promise.resolve();
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  // The same hold, in the mirror order: no READY edge mid-write for the
  // announcer to take the turn on.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.session.speak(announcedFinish("session-b")), false);

  resolveWrite?.({ status: "accepted" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The follow-up opened: the outcome is voiced rather than abandoned.
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    2,
  );
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a write that outlives the backstop cannot speak out of the spent turn", async (t) => {
  let resolveWrite: ((output: ParsedJsonObject) => void) | undefined;
  const context = harness({
    carryAction: () =>
      new Promise<ParsedJsonObject>((resolve) => {
        resolveWrite = resolve;
      }),
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
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
  await Promise.resolve();

  // The write hangs past the whole window; the backstop declares the turn
  // over, and the developer has been shown the silence.
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  t.mock.timers.reset();

  const sentBefore = context.sent.length;
  resolveWrite?.({ status: "accepted" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The outcome is still delivered as an item, so the next turn has it...
  const events = context.sent.slice(sentBefore);
  assert.ok(
    events.some(
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    ),
  );
  // ...but no reply opens out of a silence already declared.
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a done that outlives the settle backstop cannot act with the spent turn's arming", async (t) => {
  const carried: unknown[] = [];
  const context = harness({
    carryAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  await armDeveloperTurn(context);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED, response: { id: "resp-1" } });

  // The audio drains, the done never follows, and the backstop ends the turn.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  t.mock.timers.tick(REALTIME_SETTLE_TIMEOUT_MS);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  t.mock.timers.reset();

  const sentBefore = context.sent.length;
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
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

  // The turn ended with the backstop and its arming went with it: the late
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // calls are answered refused rather than run as writes out of a turn the
  // developer was already told had ended, and no reply opens over the quiet.
  assert.deepEqual(carried, []);
  const events = context.sent.slice(sentBefore);
  const output = events.find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (
      JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
        status?: string;
      }
    ).status,
    "rejected",
  );
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
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

test("a tool follow-up keeps the words said before the call and stacks the outcome", async () => {
  const context = harness({ carryAction: async () => ({ status: "accepted" }) });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
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
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      id: "resp-1",
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

  // The follow-up continues the exchange, so the sentence spoken before the
  // call stays on the strip and the outcome's words stack under it, instead
  // of the outcome erasing words still being read.
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

test("an announcement's caption names its session; a conversation's names none", async () => {
  const context = harness();
  await context.session.connect();

  // The subject stands from the moment the announcement's reply is asked for
  // — the pressable notice may precede the first word — and every caption of
  // that reply carries it.
  context.session.speak({
    providerId: "claude-code",
    providerSessionId: "session-a",
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    source: ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST,
    summary: "Checkout finished.",
    decidedAt: 1_800_000_000_000,
  });
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "Checkout just finished.",
  });
  assert.deepEqual(context.captions, [undefined, ["Checkout just finished."]]);
  assert.deepEqual(context.captionSubjects, ["session-a", "session-a"]);

  // The reply ending takes the subject with the words: the notice can never
  // outlive the announcement it stands for.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.captions.at(-1), undefined);
  assert.equal(context.captionSubjects.at(-1), undefined);

  // A conversation reply is nobody's announcement, whatever was said before.
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

const CAPTIONS_GUIDE: AppGuideSnapshot = {
  facts: [{ label: "What Luke is", detail: "A macOS sidecar living beside the notch." }],
  settings: [
    {
      id: "voice_captions",
      label: "Captions",
      description: "Luke's words on screen while he speaks.",
      kind: APP_SETTING_KIND.TOGGLE,
      value: "off",
      adjustable: true,
      manual: "the panel's Settings tab, on its Voice page",
    },
  ],
};

test("the app guide reaches the conversation, and identical guides are not resent", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateGuide(CAPTIONS_GUIDE);
  // The same knowledge again is not news; a changed value is. Neither is worth
  // an item on its own — the turn that asks is what collects the latest.
  context.session.updateGuide({ ...CAPTIONS_GUIDE });
  await armDeveloperTurn(context);
  assert.equal(contextItems(context, "[app guide").length, 1);

  const sentBefore = context.sent.length;
  context.session.updateGuide({
    ...CAPTIONS_GUIDE,
    settings: [
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      { ...CAPTIONS_GUIDE.settings[0], value: "on" } as (typeof CAPTIONS_GUIDE.settings)[0],
    ],
  });
  context.session.stopSpeaking();
  await armDeveloperTurn(context);

  const guideEvents = contextItems(context, "[app guide", sentBefore);
  assert.equal(guideEvents.length, 1);
  assert.match(itemText(guideEvents[0]), /on/);
});

test("a spoken settings change is validated against the guide and carried", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAct: async (envelope) => {
      carried.push(envelope);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateGuide(CAPTIONS_GUIDE);
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "change_app_setting",
          call_id: "call-guide-1",
          arguments: '{"setting_id":"voice_captions","value":"on"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    {
      id: "change_app_setting",
      armed: true,
      act: { kind: "setting", setting: CAPTIONS_GUIDE.settings[0], value: "on" },
    },
  ]);
});

const MODEL_GUIDE_ENTRY = {
  id: "workspace_agent_model",
  label: "New Conductor agents run",
  description: "Which model a Conductor workspace or agent created through Luke starts with.",
  kind: APP_SETTING_KIND.CHOICE,
  value: "Conductor's default",
  choices: ["Conductor's default", "Fable 5"],
  adjustable: true,
  manual: "the Conductor row under Providers",
} as const;

const MODEL_ONLY_GUIDE: AppGuideSnapshot = {
  facts: CAPTIONS_GUIDE.facts,
  settings: [MODEL_GUIDE_ENTRY],
};

const MODEL_AND_EFFORT_GUIDE: AppGuideSnapshot = {
  facts: CAPTIONS_GUIDE.facts,
  settings: [
    { ...MODEL_GUIDE_ENTRY, value: "Fable 5" },
    {
      id: "workspace_agent_effort",
      label: "New Conductor agents' effort",
      description: "How hard the chosen model thinks.",
      kind: APP_SETTING_KIND.CHOICE,
      value: "Conductor's default",
      choices: ["Conductor's default", "high", "max"],
      adjustable: true,
      manual: "the Conductor row under Providers",
    },
  ],
};

test("the second call of a turn is validated against the guide the first call's carry rewrote", async () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // A model and its effort asked for in one breath arrive as two calls in one
  // turn, and the effort entry only exists in the guide once the model is
  // stored. The renderer republishes the guide from the store's answer before
  // its carrier returns, so the calls being carried one at a time is what
  // lets the second half validate — this pins that ordering.
  const carried: { setting: string; value: string }[] = [];
  const context = harness({
    carryAppAction: async (action) => {
      if (action.kind !== "setting") return { status: "rejected" };
      carried.push({ setting: String(action.setting.id), value: action.value });
      context.session.updateGuide(MODEL_AND_EFFORT_GUIDE);
      return { status: "changed" };
    },
  });
  await context.session.connect();
  context.session.updateGuide(MODEL_ONLY_GUIDE);
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "change_app_setting",
          call_id: "call-paired-model",
          arguments: '{"setting_id":"workspace_agent_model","value":"Fable 5"}',
        },
        {
          type: "function_call",
          name: "change_app_setting",
          call_id: "call-paired-effort",
          arguments: '{"setting_id":"workspace_agent_effort","value":"high"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    { setting: "workspace_agent_model", value: "Fable 5" },
    { setting: "workspace_agent_effort", value: "high" },
  ]);
});

test("an app carrier that throws is refused with the error that caused it", async () => {
  const context = harness({
    carryAppAction: async () => {
      throw new Error("Captions could not be saved.");
    },
  });
  await context.session.connect();
  context.session.updateGuide(CAPTIONS_GUIDE);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "change_app_setting",
          call_id: "call-guide-fail",
          arguments: '{"setting_id":"voice_captions","value":"on"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const output = context.sent.slice(sentBefore).find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const parsed = JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
    status?: string;
    reason?: string;
  };
  assert.equal(parsed.status, "rejected");
  assert.equal(parsed.reason, "Captions could not be saved.");
});

test("a spoken ask about a setting the guide does not carry is refused before the carrier", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAppAction: async (action) => {
      carried.push(action);
      return { status: "changed" };
    },
  });
  await context.session.connect();
  // The guide was never provided, so the conversation was told about nothing.
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "change_app_setting",
          call_id: "call-guide-2",
          arguments: '{"setting_id":"voice_captions","value":"on"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, []);
  const output = context.sent.slice(sentBefore).find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const answered = (output?.item as { output?: string } | undefined)?.output;
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const outcome = JSON.parse(answered ?? "{}") as { status?: string };
  assert.equal(outcome.status, "rejected");
});

test("a spoken panel ask is validated against the roster and carried", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAppAction: async (action) => {
      carried.push(action);
      return { status: "shown" };
    },
  });
  await context.session.connect();
  context.session.updateGuide(CAPTIONS_GUIDE);
  context.session.updateSessions([observedSession("session-a")]);
  await armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-3",
          arguments: '{"filters":["claude-code"],"sort":"recency"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    { kind: "panel", tab: "sessions", filters: ["claude-code"], sort: "recency" },
  ]);

  // Switching to the settings tab is the same ask carried with a tab, not a
  // different act — the carrier presses the tab an open panel already shows.
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-4",
          arguments: '{"tab":"settings"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried.at(-1), { kind: "panel", tab: "settings" });

  // A workspace manager's scope is validated against the same roster: with no
  // observed session under Superset the narrowing is refused rather than
  // carried, and Luke never reports a narrowing that never happened.
  await armDeveloperTurn(context);
  const askedBefore = carried.length;
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-5",
          arguments: '{"filters":["superset"]}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(carried.length, askedBefore);

  context.session.updateSessions([
    observedSession("session-a", {
      workspace: {
        providerWorkspaceId: "workspace-1",
        scopeId: "superset",
        name: "power-vacation",
      },
    }),
  ]);
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-6",
          arguments: '{"filters":["superset"]}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried.at(-1), { kind: "panel", tab: "sessions", filters: ["superset"] });

  // A hosted chat answers its agent's filter and its apps' filters the way
  // its chips do: the agent behind the chat and an associated app are
  // identities of the same standing as the provider id, so a spoken ask
  // reaches exactly the rows the matching chip would keep.
  context.session.updateSessions([
    observedSession("session-a", {
      agent: { id: "codex", displayName: "Codex" },
      applications: [{ id: "conductor", displayName: "Conductor", scope: "session" }],
    }),
  ]);
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-7",
          arguments: '{"filters":["codex"]}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(carried.at(-1), { kind: "panel", tab: "sessions", filters: ["codex"] });

  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-8",
          arguments: '{"filters":["conductor"]}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(carried.at(-1), { kind: "panel", tab: "sessions", filters: ["conductor"] });

  // Several values combine like the chips: the observed session is a local
  // Codex chat associated with Conductor, so the combination is carried
  // whole — and one nothing occupies is refused rather than carried.
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-9",
          arguments: '{"filters":["codex","conductor","local"]}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(carried.at(-1), {
    kind: "panel",
    tab: "sessions",
    filters: ["codex", "conductor", "local"],
  });

  await armDeveloperTurn(context);
  const combinedBefore = carried.length;
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-10",
          arguments: '{"filters":["codex","cloud"]}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(carried.length, combinedBefore);
});

test("a spoken search is bounded by the list the magnifier is offered beside", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAppAction: async (action) => {
      carried.push(action);
      return { status: "shown" };
    },
  });
  await context.session.connect();
  context.session.updateGuide(CAPTIONS_GUIDE);
  context.session.updateSessions([observedSession("session-a")]);
  await armDeveloperTurn(context);

  // One session offers no magnifier, so the ask is refused rather than
  // carried into a field the panel will not draw.
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-search-1",
          arguments: '{"query":"parser"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(carried, []);

  context.session.updateSessions([observedSession("session-a"), observedSession("session-b")]);
  await armDeveloperTurn(context);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-search-2",
          arguments: '{"query":" parser "}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(carried, [{ kind: "panel", tab: "sessions", query: "parser" }]);
});

test("a spoken composer open is validated against the fixed kinds and carried, never sent", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAppAction: async (action) => {
      carried.push(action);
      return { status: "opened" };
    },
  });
  await context.session.connect();
  context.session.updateGuide(CAPTIONS_GUIDE);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "open_feedback_composer",
          call_id: "call-guide-4",
          arguments: '{"kind":"prompt","draft":"let Luke restart a stuck run"}',
        },
        // A kind outside the composer's two is refused before the carrier.
        {
          type: "function_call",
          name: "open_feedback_composer",
          call_id: "call-guide-5",
          arguments: '{"kind":"complaint"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The carrier only ever receives an open: there is no send for it to carry,
  // so a note leaves the machine only by the composer's own button.
  assert.deepEqual(carried, [
    { kind: "feedback", composer: "prompt", draft: "let Luke restart a stuck run" },
  ]);
  const outputs = context.sent
    .slice(sentBefore)
    .filter(
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    )
    .map(
      (event) =>
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        JSON.parse((event.item as { output?: string }).output ?? "{}") as {
          status?: string;
        },
    );
  assert.deepEqual(
    outputs.map((outcome) => outcome.status),
    ["opened", "rejected"],
  );
});

function trackedIssue(
  overrides: Partial<Parameters<typeof normalizeTrackedIssue>[1]> = {},
): TrackedIssue {
  const issue = normalizeTrackedIssue(
    { id: ISSUE_TRACKER_ID.LINEAR, displayName: "Linear" },
    {
      trackerIssueId: "issue-uuid-1",
      identifier: "LUKE-123",
      title: "Add Codex support",
      stateName: "In Progress",
      observedAt: 1_800_000_000_000,
      transitions: [{ id: "state-done", name: "Done" }],
      canComment: true,
      ...overrides,
    },
  );
  if (!issue) throw new Error("test fixture must normalize");
  return issue;
}

test("the conversation is told which issues the tracker lists", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateIssues([trackedIssue()]);
  await armDeveloperTurn(context);

  const [contextEvent] = contextItems(context, "[observed issue tracker");
  assert.ok(contextEvent, "the issue roster was sent");
  assert.match(itemText(contextEvent), /LUKE-123/);
  assert.match(itemText(contextEvent), /states=Done/);

  // An unchanged roster is not resent, however many turns go by.
  const sentBefore = context.sent.length;
  context.session.updateIssues([trackedIssue()]);
  context.session.stopSpeaking();
  await armDeveloperTurn(context);
  assert.deepEqual(contextItems(context, "[observed issue tracker", sentBefore), []);
});

test("a spoken issue ask is carried through its own carrier and voiced", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryIssueAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateIssues([trackedIssue()]);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "update_issue_state",
          call_id: "call-1",
          arguments: '{"tracker_id":"linear","issue_id":"LUKE-123","state":"Done"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    {
      kind: "issue-state",
      identity: { trackerId: "linear", identifier: "LUKE-123" },
      transition: { id: "state-done", name: "Done" },
    },
  ]);
  const followUp = context.sent.slice(sentBefore);
  const output = followUp.find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  assert.equal((output?.item as { output?: string } | undefined)?.output, '{"status":"accepted"}');
  assert.equal(
    followUp.at(-1)?.type,
    REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    "the outcome is voiced by the reply that follows",
  );
});

test("an issue carrier that throws is refused with the error that caused it", async () => {
  const context = harness({
    carryIssueAction: async () => {
      throw new Error("Linear could not be reached.");
    },
  });
  await context.session.connect();
  context.session.updateIssues([trackedIssue()]);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "update_issue_state",
          call_id: "call-1",
          arguments: '{"tracker_id":"linear","issue_id":"LUKE-123","state":"Done"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const output = context.sent.slice(sentBefore).find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const parsed = JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
    status?: string;
    reason?: string;
  };
  assert.equal(parsed.status, "rejected");
  assert.equal(parsed.reason, "Linear could not be reached.");
});

test("an issue call with no tracker connected is refused before any carrier runs", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryIssueAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  // No updateIssues call: no roster was ever sent.
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "update_issue_state",
          call_id: "call-1",
          arguments: '{"tracker_id":"linear","issue_id":"LUKE-123","state":"Done"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, []);
  const output = context.sent.slice(sentBefore).find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const raw = (output?.item as { output?: string } | undefined)?.output ?? "{}";
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const parsed = JSON.parse(raw) as { status?: string; reason?: string };
  assert.equal(parsed.status, "rejected");
  assert.match(parsed.reason ?? "", /no issue tracker is connected/i);
});

test("an issue call outside the roster is refused before any carrier runs", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryIssueAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateIssues([trackedIssue({ canComment: false })]);
  await armDeveloperTurn(context);
  const sentBefore = context.sent.length;

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "update_issue_state",
          call_id: "call-1",
          arguments: '{"tracker_id":"linear","issue_id":"LUKE-999","state":"Done"}',
        },
        {
          type: "function_call",
          name: "comment_on_issue",
          call_id: "call-2",
          arguments: '{"tracker_id":"linear","issue_id":"LUKE-123","body":"hi"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Nothing was carried: one call named an issue Luke was never shown, the
  // other an act the issue does not take. Both were answered anyway.
  assert.deepEqual(carried, []);
  const outputs = context.sent.slice(sentBefore).filter(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(outputs.length, 2);
  for (const event of outputs) {
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    const raw = (event.item as { output?: string } | undefined)?.output ?? "{}";
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    assert.equal((JSON.parse(raw) as { status?: string }).status, "rejected");
  }
});

test("an issue call outside a turn the developer opened cannot act", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryIssueAction: async (action) => {
      carried.push(action);
      return { status: "accepted" };
    },
  });
  await context.session.connect();
  context.session.updateIssues([trackedIssue()]);
  // No developer turn: the call arrives on a turn Luke opened himself.

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "update_issue_state",
          call_id: "call-1",
          arguments: '{"tracker_id":"linear","issue_id":"LUKE-123","state":"Done"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, []);
  const output = context.sent.find(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const raw = (output?.item as { output?: string } | undefined)?.output ?? "{}";
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  assert.equal((JSON.parse(raw) as { status?: string }).status, "rejected");
});

test("a tracker that disconnects withdraws the roster, and a reconnect resends it", async () => {
  const context = harness();
  await context.session.connect();
  context.session.updateIssues([trackedIssue()]);
  await armDeveloperTurn(context);
  const board = context.session.liveContextItemIds.get(CONTEXT_ITEM_KIND.ISSUES);
  assert.ok(board);
  const sentBefore = context.sent.length;

  // Disconnecting is news once; staying disconnected is not.
  context.session.updateIssues(undefined);
  context.session.updateIssues(undefined);
  context.session.stopSpeaking();
  await armDeveloperTurn(context);

  const withdrawals = contextItems(context, "[observed issue tracker", sentBefore).filter((event) =>
    itemText(event).includes("no longer connected"),
  );
  assert.equal(withdrawals.length, 1);
  // The withdrawal takes the board's place rather than sitting beside it: an
  // answer of "none" is still the answer to the standing question.
  assert.equal(
    context.sent.slice(sentBefore).some(
      (event) =>
        event.type === CONVERSATION_ITEM_DELETE &&
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        (event as { item_id?: string }).item_id === board,
    ),
    true,
  );

  // The same roster arriving again after a reconnect is news again.
  const reconnectBefore = context.sent.length;
  context.session.updateIssues([trackedIssue()]);
  context.session.stopSpeaking();
  await armDeveloperTurn(context);
  const rosters = contextItems(context, "[observed issue tracker", reconnectBefore).filter(
    (event) => itemText(event).includes("LUKE-123"),
  );
  assert.equal(rosters.length, 1);

  // A conversation never told about a board has nothing to withdraw, and must
  // not say a tracker is "no longer" connected when none ever was.
  const fresh = harness();
  await fresh.session.connect();
  fresh.session.updateIssues(undefined);
  await armDeveloperTurn(fresh);
  assert.deepEqual(contextItems(fresh, "[observed issue tracker"), []);
});

test("a speak-only connect never asks for the microphone", async () => {
  const context = harness();

  assert.equal(await context.session.connect({ microphone: false }), true);

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // The device was never requested, so there is no permission to ask and no
  // indicator to light.
  assert.ok(!context.calls.includes("microphone-requested"));
  // The call is speak-only by shape: audio is received and none is offered.
  assert.deepEqual(context.transceivers, [{ kind: "audio", direction: "recvonly" }]);
  assert.equal(context.session.microphoneCall, false);
});

test("a speak-only call reads a notice out but refuses a typed ask", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });
  const sentAfterConnect = context.sent.length;

  assert.equal(
    context.session.speak({
      providerId: "claude-code",
      providerSessionId: "session-a",
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      source: ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST,
      summary: "Claude Code finished checkout-service.",
      decidedAt: 1_800_000_000_000,
    }),
    true,
  );
  assert.deepEqual(
    context.sent.slice(sentAfterConnect).map((event) => event.type),
    [REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );

  // A typed ask arms tools, and this call was sent nothing to validate one
  // against: the caller stands the call down and opens the developer's own.
  assert.equal(context.session.sendText("stop the deploy"), false);
});

test("the rosters and the guide never travel on Luke's own call", async () => {
  const context = harness();
  await context.session.connect({ microphone: false });
  const before = context.sent.length;

  context.session.updateSessions([observedSession("session-a")]);
  // The history is under the same gate: Luke's own call is sent the one
  // sentence it exists to say, never the context items.
  context.session.updateConversation(
    conversationEntries({
      kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
      words: "Claude Code finished checkout-service.",
      identity: { providerId: "claude-code", providerSessionId: "session-a" },
    }),
  );
  context.session.updateGuide({
    facts: [{ label: "What Luke is", detail: "A sidecar." }],
    settings: [],
  });
  context.session.updateWorkspaceProjects([
    {
      providerId: "conductor",
      providerName: "Conductor",
      providerProjectId: "project-1",
      repository: "luke",
      taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
    },
  ]);
  context.session.updateIssues([]);

  // The stores still updated — the developer's next call starts current — but
  // nothing left on this one beyond the sentence it exists to say.
  assert.equal(context.sent.length, before);
});

test("an idle call is put away, and a call being used is not", async () => {
  const context = harness();
  await context.session.connect();

  // Settled and unused: the clock is running.
  assert.equal(context.idleArmed(), true);
  assert.equal(context.idleDelayMs(), VOICE_IDLE_TIMEOUT_MS);

  // A turn stops it. A call someone is talking on is never put away underneath
  // them, however long the turn runs.
  await holdTurn(context);
  assert.equal(context.idleArmed(), false);
  context.session.stopListening(false);
  assert.equal(context.idleArmed(), true);
  // The device never waits for the retirement: it left with the turn.
  assert.equal(context.microphoneStopped(), true);

  context.fireIdle();

  // What the retirement puts away is the conversation; the device is long gone.
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
});

test("an idle call that was taken up in the meantime is left alone", async () => {
  const context = harness();
  await context.session.connect();
  await holdTurn(context);

  // Ten minutes is long enough for the timer to fire against a call that has
  // since been taken up, so the decision is made again at the moment of it.
  context.fireIdle();

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("Luke's own call is not on the developer's idle clock", async () => {
  const context = harness();

  await context.session.connect({ microphone: false });

  // It holds no device and already puts itself away once its queue is quiet.
  assert.equal(context.idleArmed(), false);
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
  assert.equal(context.replacedTracks().at(-1), null);
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
  context.session.updateSessions([observedSession("session-a")]);
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

test("a spoken tool call is still validated in both processes", () => {
  const renderer = readFileSync(new URL("./realtime-session.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../main/ipc/session-acts.ts", import.meta.url), "utf8");

  // The renderer validates against the roster and the guide before a carrier runs.
  assert.match(renderer, /\bsessionToolAction\b/);
  assert.match(renderer, /\bissueToolAction\b/);
  assert.match(renderer, /\bappToolAction\b/);

  // The main process must not share those validators: it re-checks against its
  // own registry before an adapter or tracker sees anything.
  assert.doesNotMatch(main, /\bsessionToolAction\b/);
  assert.doesNotMatch(main, /\bissueToolAction\b/);
  assert.doesNotMatch(main, /\bappToolAction\b/);
  assert.match(main, /sessionRegistry\.get/);
  assert.match(main, /BRIDGE\.executeIssueAction/);
  assert.match(renderer, /carryAct\(\{ id: call\.name, act: action, armed \}\)/);
  assert.match(main, /if \(!envelope\.armed\)/);
  assert.match(main, /actValidationTarget\(envelope\.id\)/);
});
