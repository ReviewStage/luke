import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  type NormalizedSession,
  normalizeSession,
  type ProviderSessionObservation,
  REALTIME_CLIENT_EVENT,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeConnection,
  SESSION_STATUS,
} from "@sidecar/core";
import { RealtimeVoiceSession } from "../src/renderer/realtime-session";

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
  microphoneEnabled: () => boolean;
  microphoneStopped: () => boolean;
  emit: (event: unknown) => void;
  lukeAudible: () => boolean;
  deliverRemoteTrack: () => void;
  setConnectionState: (state: RTCPeerConnectionState) => void;
  closeChannel: () => void;
  requests: { url: string; init: RequestInit }[];
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
  } = {},
): Harness {
  const sent: Record<string, unknown>[] = [];
  const errors: (string | undefined)[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
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

  const session = new RealtimeVoiceSession({
    requestConnection: async () => {
      if (options.connectionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.connectionDelayMs));
      }
      if (options.connectionError) throw options.connectionError;
      return "connection" in options ? options.connection : CONNECTION;
    },
    requestMicrophoneStream: async () => {
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
    onStatus: () => undefined,
    onLocalStream: () => undefined,
    onRemoteStream: () => undefined,
    onError: (message) => errors.push(message),
  });

  return {
    session,
    sent,
    errors,
    microphoneEnabled: () => enabled,
    microphoneStopped: () => stopped,
    lukeAudible: () => remoteTrack.enabled,
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
  assert.equal(context.sent[0]?.type, REALTIME_CLIENT_EVENT.RESPONSE_CREATE);
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

test("taking the turn silences Luke rather than only stopping generation", async () => {
  const context = harness();
  await context.session.connect();
  context.deliverRemoteTrack();
  context.session.toggleTurn();
  context.session.toggleTurn();
  assert.equal(context.session.status, REALTIME_STATUS.RESPONDING);
  assert.equal(context.lukeAudible(), true);

  context.session.toggleTurn();

  // Cancelling stops the model producing more; it does not stop what is already
  // on its way down the connection. Only this end can.
  assert.equal(context.lukeAudible(), false);
  assert.equal(context.session.status, REALTIME_STATUS.LISTENING);

  // The next reply has to be audible again.
  context.session.toggleTurn();
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
    [REALTIME_CLIENT_EVENT.RESPONSE_CANCEL, REALTIME_CLIENT_EVENT.INPUT_AUDIO_BUFFER_CLEAR],
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
