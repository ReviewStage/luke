import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_SETTING_KIND,
  type AppGuideSnapshot,
  ATTENTION_DISPOSITION,
  ISSUE_TRACKER_ID,
  type NormalizedSession,
  normalizeSession,
  normalizeTrackedIssue,
  type ProviderSessionObservation,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeConnection,
  SESSION_STATUS,
  type TrackedIssue,
} from "@sidecar/core";
import {
  type AppActionCarrier,
  type IssueActionCarrier,
  quietIsLukesOwn,
  RealtimeVoiceSession,
  type SessionActionCarrier,
} from "../src/renderer/realtime-session";

const CONNECTION: RealtimeConnection = {
  value: "ek_test_secret",
  expiresAt: 1_800_000_060_000,
  model: "gpt-realtime-2.1",
  callsUrl: "https://api.openai.com/v1/realtime/calls",
};

interface Harness {
  session: RealtimeVoiceSession;
  sent: Record<string, unknown>[];
  errors: (string | undefined)[];
  captions: (string | undefined)[];
  microphoneEnabled: () => boolean;
  microphoneStopped: () => boolean;
  emit: (event: unknown) => void;
  lukeAudible: () => boolean;
  deliverRemoteTrack: () => void;
  provideConnection: () => void;
  setConnectionState: (state: RTCPeerConnectionState) => void;
  closeChannel: () => void;
  requests: { url: string; init: RequestInit }[];
  /** The order the credential and the device were asked for and answered in. */
  calls: string[];
}

function observedSession(
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): NormalizedSession {
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
    carryAction?: SessionActionCarrier;
    carryAppAction?: AppActionCarrier;
    carryIssueAction?: IssueActionCarrier;
  } = {},
): Harness {
  const sent: Record<string, unknown>[] = [];
  const errors: (string | undefined)[] = [];
  const captions: (string | undefined)[] = [];
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
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };

  const channel: Record<string, unknown> = {
    // A channel that never opens models a stalled handshake.
    readyState: options.channelOpensImmediately === false ? "connecting" : "open",
    send: (payload: string) => sent.push(JSON.parse(payload) as Record<string, unknown>),
    close: () => {
      channel.readyState = "closed";
      // A real channel fires onclose after close(), which is exactly how a
      // teardown can re-enter and overwrite the status it was setting.
      queueMicrotask(() => (channel.onclose as (() => void) | null | undefined)?.());
    },
  };

  const remoteTrack = { enabled: true };
  const peer: Record<string, unknown> = {
    localDescription: { type: "offer", sdp: "v=0 local" },
    connectionState: "connected",
    addTrack: () => undefined,
    createDataChannel: () => channel,
    createOffer: async () => ({ type: "offer", sdp: "v=0 local" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
    close: () => {
      peer.connectionState = "closed";
      // A real peer drives connectionstatechange on close, which is exactly how
      // a teardown can re-enter and report an intentional stop as a failure.
      queueMicrotask(() => (peer.onconnectionstatechange as (() => void) | null | undefined)?.());
    },
  };

  let connection = "connection" in options ? options.connection : CONNECTION;
  const session = new RealtimeVoiceSession({
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
      if (options.microphoneError) throw options.microphoneError;
      return stream as unknown as MediaStream;
    },
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    exchangeDescription: async (url, init) => {
      requests.push({ url, init });
      if (options.sdpDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.sdpDelayMs));
      }
      return options.sdpResponse ?? new Response("v=0 remote", { status: 200 });
    },
    ...(options.connectTimeoutMs === undefined
      ? {}
      : { connectTimeoutMs: options.connectTimeoutMs }),
    ...(options.now ? { now: options.now } : {}),
    ...(options.carryAction ? { carryAction: options.carryAction } : {}),
    ...(options.carryAppAction ? { carryAppAction: options.carryAppAction } : {}),
    ...(options.carryIssueAction ? { carryIssueAction: options.carryIssueAction } : {}),
    onStatus: () => undefined,
    onLocalStream: () => undefined,
    onRemoteStream: () => undefined,
    onError: (message) => errors.push(message),
    onCaption: (text) => captions.push(text),
  });

  return {
    session,
    sent,
    errors,
    captions,
    microphoneEnabled: () => enabled,
    microphoneStopped: () => stopped,
    lukeAudible: () => remoteTrack.enabled,
    provideConnection: () => {
      connection = CONNECTION;
    },
    deliverRemoteTrack: () => {
      (peer.ontrack as ((e: unknown) => void) | undefined)?.({
        track: remoteTrack,
        streams: [{}],
      });
    },
    emit: (event) => {
      const onmessage = channel.onmessage as ((event: { data: string }) => void) | undefined;
      onmessage?.({ data: JSON.stringify(event) });
    },
    setConnectionState: (state) => {
      peer.connectionState = state;
      (peer.onconnectionstatechange as (() => void) | undefined)?.();
    },
    closeChannel: () => {
      channel.readyState = "closed";
      (channel.onclose as (() => void) | undefined)?.();
    },
    requests,
    calls,
  };
}

test("connecting opens the call and leaves the microphone closed", async () => {
  const context = harness();

  assert.equal(await context.session.connect(), true);
  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // Connected is not the same as listening. Nothing is sent until asked.
  assert.equal(context.microphoneEnabled(), false);

  const request = context.requests[0];
  assert.equal(request?.url, CONNECTION.callsUrl);
  const headers = request?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${CONNECTION.value}`);
  assert.equal(headers["content-type"], "application/sdp");
  assert.equal(request?.init.body, "v=0 local");
});

test("no credential leaves the voice experience explicitly unavailable", async () => {
  const context = harness({ connection: undefined });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.UNAVAILABLE);
  assert.deepEqual(context.sent, []);
  // The device was opened alongside the mint that came back empty, and nothing
  // else is left to let go of it.
  assert.equal(context.microphoneStopped(), true);
});

test("the credential and the device are asked for together, not in turn", async () => {
  // The mint is a network round trip and the device open is a hardware one.
  // The press that started the connect is waiting on both, so the device must
  // not queue behind the mint.
  const context = harness({ connectionDelayMs: 20 });

  assert.equal(await context.session.connect(), true);
  assert.deepEqual(context.calls, [
    "credential-requested",
    "microphone-requested",
    "credential-resolved",
  ]);
});

test("a refused call fails without leaking the ephemeral secret", async () => {
  const context = harness({ sdpResponse: new Response("nope", { status: 403 }) });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  const reported = context.errors.filter((message) => message !== undefined).join(" ");
  assert.match(reported, /403/);
  assert.ok(!reported.includes(CONNECTION.value));
});

test("a denied microphone fails the connection rather than half-opening it", async () => {
  const context = harness({ microphoneError: new Error("Permission denied") });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  assert.ok(context.errors.includes("Permission denied"));
});

test("push-to-talk opens the microphone only while held, then asks for a reply", async () => {
  const context = harness();
  await context.session.connect();

  context.session.startListening();
  assert.equal(context.microphoneEnabled(), true);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  context.session.stopListening(true);
  assert.equal(context.microphoneEnabled(), false);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
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

  context.session.startListening();
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
  assert.deepEqual(context.sent, []);
});

test("a proactive update is spoken once the call is open", async () => {
  const context = harness();
  const speech = {
    providerId: "claude-code",
    providerSessionId: "session-a",
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    summary: "Claude Code is waiting on you in checkout-service.",
    decidedAt: 1_800_000_000_000,
  };

  // Nothing is spoken before there is a call to speak over.
  assert.equal(context.session.speak(speech), false);

  await context.session.connect();
  assert.equal(context.session.speak(speech), true);
  // The sentence is handed over as a message and the reply asked for after it,
  // so the request cannot arrive before the words it is meant to read.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
});

test("a held turn lasts exactly as long as the key is down", async () => {
  const context = harness();
  await context.session.connect();

  context.session.beginTurn();
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
  // The microphone opens with the call, so a key held and released during the
  // handshake was held over nothing. Committing it would ask the server to
  // answer an empty buffer, which comes back as an error rather than a reply.
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
  context.session.beginTurn();
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.session.beginTurn();

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.lukeAudible(), false);
});

test("a press during the handshake opens the turn it was asking for", async () => {
  const context = harness({ connectionDelayMs: 5 });

  // The order a talk key produces: the press comes first, and the call is what
  // it starts. Nothing is captured until the microphone opens at the far end.
  context.session.toggleTurn();
  await context.session.connect();

  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
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
  context.session.beginTurn();
  context.session.endTurn(true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  // Generation finishing is not speech finishing, so the turn holds.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("two sentences are one reply, whatever the pause between them", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();

  // One reply that ends properly, which is how this call shows it reports the
  // end of its own audio.
  context.session.beginTurn();
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });
  assert.equal(context.session.status, REALTIME_STATUS.READY);

  // A longer one. Generation finishes while he is still on the first sentence.
  context.session.beginTurn();
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
  context.session.beginTurn();
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

test("the quiet before Luke starts is not Luke going quiet", () => {
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
  context.session.toggleTurn();

  // Luke draws breath mid-sentence; the reply is still coming.
  context.session.reportRemoteAudioIdle();

  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a finished response returns the session to ready", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  context.session.toggleTurn();

  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  context.session.reportRemoteAudioIdle();

  assert.equal(context.session.status, REALTIME_STATUS.READY);
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
  // A frame outside the protocol is dropped by the handler rather than thrown.
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("a failed call releases the microphone instead of stranding it", async () => {
  const context = harness({ sdpResponse: new Response("nope", { status: 403 }) });

  await context.session.connect();

  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  // FAILED offers "Start voice" again, so nothing may still hold the device.
  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.isConnected, false);
});

test("a stalled handshake times out instead of hanging on connecting", async () => {
  const context = harness({ channelOpensImmediately: false, connectTimeoutMs: 40 });

  assert.equal(await context.session.connect(), false);
  assert.equal(context.session.status, REALTIME_STATUS.FAILED);
  assert.equal(context.microphoneStopped(), true);
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

  context.closeChannel();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
  assert.equal(context.session.isConnected, false);
});

test("an error instead of response.done still frees the turn", async () => {
  const context = harness();
  await context.session.connect();
  context.session.toggleTurn();
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);

  // An empty push-to-talk commit reports an error with no matching done.
  context.emit({
    type: REALTIME_SERVER_EVENT.ERROR,
    error: { message: "Audio buffer is empty" },
  });

  assert.equal(context.session.status, REALTIME_STATUS.READY);
  // Turn-taking still works rather than being stuck forever.
  assert.equal(context.session.startListening(), true);
});

test("the conversation is told which sessions Luke can see", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateSessions([
    observedSession("session-a", { status: SESSION_STATUS.WAITING, summary: "Waiting on input." }),
  ]);

  const item = context.sent.find(
    (event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
  );
  const text = JSON.stringify(item);
  assert.ok(text.includes("Claude Code"));
  assert.ok(text.includes("waiting"));
  assert.ok(text.includes("Waiting on input."));
  // Context must not make Luke start talking on its own.
  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE).length,
    0,
  );
  assert.equal(context.session.status, REALTIME_STATUS.READY);
});

test("an unchanged session roster is not resent", async () => {
  const context = harness();
  await context.session.connect();
  const roster = [observedSession("session-a")];

  context.session.updateSessions(roster);
  context.session.updateSessions([observedSession("session-a")]);

  assert.equal(
    context.sent.filter((event) => event.type === REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE)
      .length,
    1,
  );
});

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
  assert.equal(context.microphoneStopped(), true);
});

test("a stop during minting is not reported as unavailable", async () => {
  // The stop lands first, then the mint comes back empty. Without the guard the
  // empty result is treated as a fresh diagnosis and overwrites the idle state
  // the developer asked for.
  const context = harness({ connectionDelayMs: 20, connection: undefined });

  const connecting = context.session.connect();
  await context.session.close();

  assert.equal(await connecting, false);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
});

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
  assert.equal(context.session.startListening(), true);
});

test("stopping after the device is open still releases it", async () => {
  // The mint resolves immediately and the SDP exchange is slow, so the stop
  // lands once the microphone exists but before the call is up. Closing during
  // the mint is a different case, covered above, where nothing is held yet.
  const context = harness({ sdpDelayMs: 40 });

  const connecting = context.session.connect();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await context.session.close();

  assert.equal(await connecting, false);
  assert.equal(context.microphoneStopped(), true);
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
    summary: "Claude Code is waiting on you in checkout-service.",
    decidedAt: 1_800_000_000_000,
  };

  // While the developer holds the microphone open.
  context.session.startListening();
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

  // One key: press to open a turn, press again to send it.
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
  // A muted track still transmits, so a turn has to start from an empty buffer.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR],
  );

  context.session.toggleTurn();
  assert.equal(context.microphoneEnabled(), false);
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_COMMIT,
      REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    ],
  );
});

test("the tail of an interrupted reply is not heard as the answer to the next", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  context.session.beginTurn();
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);

  // Cut him off, say something else, and send it.
  context.session.beginTurn();
  assert.equal(context.lukeAudible(), false);
  context.session.endTurn(true);

  // The rest of the old reply is still arriving — the server sent it before it
  // was told to stop — so opening the track when the next turn is sent would
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
  context.session.beginTurn();
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
  context.session.beginTurn();
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

  context.session.beginTurn();
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_ITEM_ADDED, item: { id: "first" } });
  clock = 1_100;
  context.session.reportRemoteAudioActive();
  clock = 5_000;
  context.session.beginTurn();

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
  context.session.beginTurn();
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
  context.session.beginTurn();
  context.session.endTurn(true);
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  context.session.beginTurn();
  context.session.endTurn(true);
  assert.equal(context.lukeAudible(), false);

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
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  // Audible once the server says the reply is under way, rather than when it
  // was asked for: until then anything arriving belongs to whatever came before.
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_CREATED });
  assert.equal(context.lukeAudible(), true);

  context.session.toggleTurn();

  // Cancelling stops the model producing more; it does not stop what is already
  // on its way down the connection. Only this end can.
  assert.equal(context.lukeAudible(), false);
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
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  context.sent.length = 0;

  context.session.toggleTurn();

  // The developer's turn always wins: the reply is stopped, not queued behind.
  assert.deepEqual(
    context.sent.map((event) => event.type),
    [
      REALTIME_CLIENT_EVENT.RESPONSE_CANCEL,
      // What the model already produced is dropped as well, or the rest of the
      // sentence plays on over the turn that interrupted it.
      REALTIME_CLIENT_EVENT.OUTPUT_AUDIO_BUFFER_CLEAR,
      REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR,
    ],
  );
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
  assert.equal(context.microphoneEnabled(), true);
});

test("closing stops the microphone track", async () => {
  const context = harness();
  await context.session.connect();

  await context.session.close();

  assert.equal(context.microphoneStopped(), true);
  assert.equal(context.session.status, REALTIME_STATUS.IDLE);
});
/** Opens and commits a developer turn, which is the only turn a tool may run in. */
function armDeveloperTurn(context: Harness): void {
  context.session.startListening();
  context.session.stopListening(true);
}

test("a typed ask opens a developer turn and asks for the reply to it", async () => {
  const context = harness();
  await context.session.connect();
  const sentBefore = context.sent.length;

  assert.equal(context.session.sendText("What needs me right now?"), true);
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  // The microphone stays exactly as it was: typing never opens the device.
  assert.equal(context.microphoneEnabled(), false);
  const events = context.sent.slice(sentBefore);
  assert.deepEqual(
    events.map((event) => event.type),
    [REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE, REALTIME_CLIENT_EVENT.RESPONSE_CREATE],
  );
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
  // The outcome is voiced, exactly as a spoken ask's would be.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
});

test("a typed ask interrupts the reply it arrives over", async () => {
  let now = 10_000;
  const context = harness({ now: () => now });
  await context.session.connect();
  context.deliverRemoteTrack();
  armDeveloperTurn(context);
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
  armDeveloperTurn(context);
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
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(
    (
      JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
        status?: string;
      }
    ).status,
    "refused",
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
  armDeveloperTurn(context);
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
  context.session.startListening();
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
  assert.deepEqual(context.sent, []);
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
  armDeveloperTurn(context);
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
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal((output?.item as { output?: string } | undefined)?.output, '{"status":"accepted"}');
  assert.equal(
    followUp.at(-1)?.type,
    REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    "the outcome is voiced by the reply that follows",
  );
  // The turn never ended: the reply resumes over the outcome.
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
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
  armDeveloperTurn(context);
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
  // reads the link back out of its own registry, the same as a pressed row.
  assert.deepEqual(carried, [
    { kind: "open", identity: { providerId: "claude-code", providerSessionId: "session-a" } },
  ]);
  const outputs = context.sent
    .slice(sentBefore)
    .filter(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    );
  const statuses = outputs.map(
    (event) =>
      (
        JSON.parse((event.item as { output?: string } | undefined)?.output ?? "{}") as {
          status?: string;
        }
      ).status,
  );
  assert.deepEqual(statuses, ["opened", "refused"]);
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
  const sentBeforeContext = context.sent.length;
  context.session.updateWorkspaceProjects([
    {
      providerId: "conductor",
      providerName: "Conductor",
      providerProjectId: "proj-1",
      repository: "luke",
      taskSupport: "optional",
    },
  ]);
  // The projects travel as context the way the roster does, and an identical
  // list is not resent.
  const contextEvent = context.sent.slice(sentBeforeContext).at(0);
  assert.match(
    ((contextEvent?.item as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text ??
      "") as string,
    /^\[workspace projects, sent automatically\]/,
  );
  context.session.updateWorkspaceProjects([
    {
      providerId: "conductor",
      providerName: "Conductor",
      providerProjectId: "proj-1",
      repository: "luke",
      taskSupport: "optional",
    },
  ]);
  assert.equal(context.sent.length, sentBeforeContext + 1);

  armDeveloperTurn(context);
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
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Only the listed project reaches the carrier; the unlisted one is refused
  // before any bridge call exists.
  assert.deepEqual(carried, [
    {
      kind: "create-workspace",
      providerId: "conductor",
      providerProjectId: "proj-1",
      name: "fix the panel",
      task: "wire the XYZ feature",
    },
  ]);
  const outputs = context.sent
    .slice(sentBefore)
    .filter(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    );
  const statuses = outputs.map(
    (event) =>
      (
        JSON.parse((event.item as { output?: string } | undefined)?.output ?? "{}") as {
          status?: string;
        }
      ).status,
  );
  assert.deepEqual(statuses, ["accepted", "refused"]);
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
  armDeveloperTurn(context);
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
  const outputs = context.sent
    .slice(sentBefore)
    .filter(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    );
  const statuses = outputs.map(
    (event) =>
      (
        JSON.parse((event.item as { output?: string } | undefined)?.output ?? "{}") as {
          status?: string;
        }
      ).status,
  );
  assert.deepEqual(statuses, ["accepted", "refused"]);
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
  armDeveloperTurn(context);
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
  const outputs = context.sent
    .slice(sentBefore)
    .filter(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    );
  assert.equal(outputs.length, 2);
  for (const event of outputs) {
    const raw = (event.item as { output?: string } | undefined)?.output ?? "{}";
    assert.equal((JSON.parse(raw) as { status?: string }).status, "refused");
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
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal(
    (
      JSON.parse((output?.item as { output?: string } | undefined)?.output ?? "{}") as {
        status?: string;
      }
    ).status,
    "refused",
  );
  // The call is answered so the model is not left waiting, but the turn opens
  // no reply: a turn Luke was not asked to act in must not talk on either.
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
});

test("a tool outcome is not spoken over a turn the developer has taken", async () => {
  let resolveWrite: ((output: Record<string, unknown>) => void) | undefined;
  const context = harness({
    carryAction: () =>
      new Promise<Record<string, unknown>>((resolve) => {
        resolveWrite = resolve;
      }),
  });
  await context.session.connect();
  context.session.updateSessions([observedSession("session-a", { canReceiveMessage: true })]);
  armDeveloperTurn(context);
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
  context.session.startListening();
  resolveWrite?.({ status: "accepted" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const events = context.sent.slice(sentBefore);
  // The outcome was still delivered as an item, so the next turn has it...
  assert.ok(
    events.some(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    ),
  );
  // ...but no reply was opened to voice it over the microphone now open.
  assert.ok(!events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE));
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);
});

test("the caption grows with the deltas and the final text supersedes them", async () => {
  const context = harness();
  await context.session.connect();
  context.session.beginTurn();
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
    "Two sessions ",
    "Two sessions need review.",
    "Two sessions need review, and one failed.",
  ]);
});

test("the caption leaves when the reply does", async () => {
  const context = harness();
  await context.session.connect();
  context.session.beginTurn();
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "All quiet.",
  });
  context.emit({ type: REALTIME_SERVER_EVENT.RESPONSE_DONE });
  // Generation finishing is not speech finishing: the words stay up while
  // Luke is still saying them.
  assert.deepEqual(context.captions, ["All quiet."]);

  context.emit({ type: REALTIME_SERVER_EVENT.OUTPUT_AUDIO_BUFFER_STOPPED });

  assert.deepEqual(context.captions, ["All quiet.", undefined]);
});

test("taking the turn cuts the caption with the audio", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  context.session.beginTurn();
  context.session.endTurn(true);
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    delta: "A sentence the developer is about to talk over",
  });

  // The caption already holds words the room has not heard — the text runs
  // ahead of the speech — so an interrupt must take it down at once rather
  // than leaving Luke finishing a sentence he was stopped from saying.
  context.session.startListening();

  assert.equal(context.captions.at(-1), undefined);
  assert.equal(context.captions.length, 2);
});

test("a cancelled reply's late transcript cannot pollute the next caption", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  context.session.beginTurn();
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
  context.session.startListening();
  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_OUTPUT_AUDIO_TRANSCRIPT_DELTA,
    item_id: "item-first",
    delta: ", still streaming in",
  });
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

  assert.equal(context.captions.at(-1), "The second reply");
  assert.equal(context.captions.includes("The first reply, finished anyway."), false);
  assert.equal(
    context.captions.some((caption) => caption?.includes("still streaming in")),
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
      manual: "the panel's Settings tab, under Preferences",
    },
  ],
};

test("the app guide reaches the conversation, and identical guides are not resent", async () => {
  const context = harness();
  await context.session.connect();
  const sentBefore = context.sent.length;

  context.session.updateGuide(CAPTIONS_GUIDE);
  // The same knowledge again is not news; a changed value is.
  context.session.updateGuide({ ...CAPTIONS_GUIDE });
  context.session.updateGuide({
    ...CAPTIONS_GUIDE,
    settings: [
      { ...CAPTIONS_GUIDE.settings[0], value: "on" } as (typeof CAPTIONS_GUIDE.settings)[0],
    ],
  });

  const guideEvents = context.sent.slice(sentBefore).filter((event) => {
    const item = event.item as { content?: { text?: string }[] } | undefined;
    return item?.content?.[0]?.text?.startsWith("[app guide") === true;
  });
  assert.equal(guideEvents.length, 2);
  // Context, not a prompt: telling Luke about himself never opens his mouth.
  assert.equal(
    context.sent
      .slice(sentBefore)
      .some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE),
    false,
  );
});

test("a spoken settings change is validated against the guide and carried", async () => {
  const carried: unknown[] = [];
  const context = harness({
    carryAppAction: async (action) => {
      carried.push(action);
      return { status: "changed" };
    },
  });
  await context.session.connect();
  context.session.updateGuide(CAPTIONS_GUIDE);
  armDeveloperTurn(context);

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
    { kind: "setting", setting: CAPTIONS_GUIDE.settings[0], value: "on" },
  ]);
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
  armDeveloperTurn(context);
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
  const output = context.sent
    .slice(sentBefore)
    .find(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    );
  const answered = (output?.item as { output?: string } | undefined)?.output;
  const outcome = JSON.parse(answered ?? "{}") as { status?: string };
  assert.equal(outcome.status, "refused");
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
  armDeveloperTurn(context);

  context.emit({
    type: REALTIME_SERVER_EVENT.RESPONSE_DONE,
    response: {
      output: [
        {
          type: "function_call",
          name: "show_panel",
          call_id: "call-guide-3",
          arguments: '{"filter":"claude-code","sort":"recency"}',
        },
      ],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(carried, [
    { kind: "panel", tab: "sessions", filter: "claude-code", sort: "recency" },
  ]);
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
  armDeveloperTurn(context);
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
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    )
    .map(
      (event) =>
        JSON.parse((event.item as { output?: string }).output ?? "{}") as {
          status?: string;
        },
    );
  assert.deepEqual(
    outputs.map((outcome) => outcome.status),
    ["opened", "refused"],
  );
});

function trackedIssue(
  overrides: Partial<Parameters<typeof normalizeTrackedIssue>[1]> = {},
): TrackedIssue {
  return normalizeTrackedIssue(
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
}

test("the conversation is told which issues the tracker lists", async () => {
  const context = harness();
  await context.session.connect();

  context.session.updateIssues([trackedIssue()]);

  const contextEvent = context.sent.find((event) => {
    const item = event.item as { content?: { text?: string }[] } | undefined;
    return item?.content?.[0]?.text?.includes("[observed issue tracker, sent automatically]");
  });
  assert.ok(contextEvent, "the issue roster was sent");
  const text =
    (contextEvent?.item as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text ?? "";
  assert.match(text, /LUKE-123/);
  assert.match(text, /states: Done/);
  // Context is never a prompt: nothing here asks Luke to start talking.
  assert.equal(
    context.sent.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE),
    false,
  );

  // An unchanged roster is not resent.
  const sentBefore = context.sent.length;
  context.session.updateIssues([trackedIssue()]);
  assert.equal(context.sent.length, sentBefore);
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
  armDeveloperTurn(context);
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
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  assert.equal((output?.item as { output?: string } | undefined)?.output, '{"status":"accepted"}');
  assert.equal(
    followUp.at(-1)?.type,
    REALTIME_CLIENT_EVENT.RESPONSE_CREATE,
    "the outcome is voiced by the reply that follows",
  );
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
  armDeveloperTurn(context);
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
  const output = context.sent
    .slice(sentBefore)
    .find(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    );
  const raw = (output?.item as { output?: string } | undefined)?.output ?? "{}";
  const parsed = JSON.parse(raw) as { status?: string; reason?: string };
  assert.equal(parsed.status, "refused");
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
  armDeveloperTurn(context);
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
  const outputs = context.sent
    .slice(sentBefore)
    .filter(
      (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
    );
  assert.equal(outputs.length, 2);
  for (const event of outputs) {
    const raw = (event.item as { output?: string } | undefined)?.output ?? "{}";
    assert.equal((JSON.parse(raw) as { status?: string }).status, "refused");
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
    (event) => (event.item as { type?: string } | undefined)?.type === "function_call_output",
  );
  const raw = (output?.item as { output?: string } | undefined)?.output ?? "{}";
  assert.equal((JSON.parse(raw) as { status?: string }).status, "refused");
});

test("a tracker that disconnects withdraws the roster, and a reconnect resends it", async () => {
  const context = harness();
  await context.session.connect();
  context.session.updateIssues([trackedIssue()]);
  const sentBefore = context.sent.length;

  // Disconnecting is news once; staying disconnected is not.
  context.session.updateIssues(undefined);
  context.session.updateIssues(undefined);

  const withdrawals = context.sent.slice(sentBefore).filter((event) => {
    const item = event.item as { content?: { text?: string }[] } | undefined;
    return item?.content?.[0]?.text?.includes("no longer connected") === true;
  });
  assert.equal(withdrawals.length, 1);

  // The same roster arriving again after a reconnect is news again: the
  // conversation was told to disregard it, so it has to be retold.
  context.session.updateIssues([trackedIssue()]);
  const rosters = context.sent.slice(sentBefore).filter((event) => {
    const item = event.item as { content?: { text?: string }[] } | undefined;
    return item?.content?.[0]?.text?.includes("LUKE-123") === true;
  });
  assert.equal(rosters.length, 1);

  // A conversation never told about a board has nothing to withdraw.
  const fresh = harness();
  await fresh.session.connect();
  const freshBefore = fresh.sent.length;
  fresh.session.updateIssues(undefined);
  assert.equal(fresh.sent.length, freshBefore);
});
