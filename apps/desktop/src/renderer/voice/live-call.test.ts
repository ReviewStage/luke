import assert from "node:assert/strict";
import test from "node:test";
import { TRACE_DIRECTION } from "@sidecar/devtrace/vocabulary";
import { LIVE_TRANSPORT_STATE, type LiveTransportState } from "@sidecar/gateway";
import {
  LIVE_CLIENT_EVENT,
  LIVE_IDLE_WINDOW_MS,
  LIVE_SERVER_EVENT,
  LIVE_STATUS,
  type LiveStatus,
} from "@sidecar/live";
import { drainMicrotasks, FakeClock } from "@sidecar/runtime/testing";
import type { LiveCaptionRow } from "@sidecar/voice/orchestrator";
import type { WireRecord } from "@sidecar/wire";
import {
  LiveCall,
  MICROPHONE_ACK_TIMEOUT_MS,
  SESSION_CLOSE_TIMEOUT_MS,
  SESSION_START_TIMEOUT_MS,
  SPEAKING_HANGOVER_MS,
} from "./live-call";
import {
  LIVE_EVENTS_CHANNEL_LABEL,
  type LiveDataChannel,
  type LivePeerConnection,
  type LiveTrackSender,
} from "./live-peer";

/** What the fake peer did, in the order it did it, so the guide's order can be asserted. */
type PeerStep =
  | "add-track"
  | "add-transceiver"
  | "create-channel"
  | "create-offer"
  | "set-local"
  | "set-remote"
  | "close";

class FakeChannel implements LiveDataChannel {
  readyState = "connecting";
  readonly sent: WireRecord[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  send(data: string): void {
    // SAFETY: the call sends its own JSON; parsing it back yields the record it built.
    this.sent.push(JSON.parse(data) as WireRecord);
  }

  close(): void {
    this.readyState = "closed";
  }

  /** The server's event, as the channel would hand it up. */
  receive(event: WireRecord): void {
    // SAFETY: the call reads only `data` off the message event.
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
  }

  dropped(): void {
    this.readyState = "closed";
    // SAFETY: the call reads nothing off the close event.
    this.onclose?.({} as Event);
  }
}

class FakeTrack {
  enabled = true;
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakePeerConnection implements LivePeerConnection {
  connectionState = "new";
  iceGatheringState = "gathering";
  localDescription: { sdp: string } | null = null;
  readonly steps: PeerStep[] = [];
  readonly channels: FakeChannel[] = [];
  readonly replaced: (MediaStreamTrack | null)[] = [];
  remoteSdp: string | undefined;
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  readonly sender: LiveTrackSender = {
    replaceTrack: async (track) => {
      this.replaced.push(track);
    },
  };

  createDataChannel(label: string): LiveDataChannel {
    assert.equal(label, LIVE_EVENTS_CHANNEL_LABEL);
    this.steps.push("create-channel");
    const channel = new FakeChannel();
    this.channels.push(channel);
    return channel;
  }

  addTrack(): LiveTrackSender {
    this.steps.push("add-track");
    return this.sender;
  }

  addTransceiver(): ReturnType<LivePeerConnection["addTransceiver"]> {
    this.steps.push("add-transceiver");
    return { sender: this.sender };
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.steps.push("create-offer");
    return { type: "offer", sdp: "v=0\r\noffer\r\n" };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.steps.push("set-local");
    this.localDescription = { sdp: description.sdp ?? "" };
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.steps.push("set-remote");
    this.remoteSdp = description.sdp;
  }

  close(): void {
    this.steps.push("close");
    this.connectionState = "closed";
  }

  gathered(): void {
    this.iceGatheringState = "complete";
    // SAFETY: the call reads nothing off the gathering event.
    this.onicegatheringstatechange?.({} as Event);
  }

  transport(state: string): void {
    this.connectionState = state;
    // SAFETY: the call reads nothing off the state event.
    this.onconnectionstatechange?.({} as Event);
  }
}

function fixture(options: { microphone?: boolean; sessionCreated?: boolean } = {}) {
  let microphoneGranted = options.microphone !== false;
  const clock = new FakeClock();
  const peer = new FakePeerConnection();
  const track = new FakeTrack();
  const stream = new FakeStream([track]);
  const statuses: LiveStatus[] = [];
  const captions: (readonly LiveCaptionRow[])[] = [];
  const errors: (string | undefined)[] = [];
  const offers: string[] = [];
  const transports: LiveTransportState[] = [];
  const activity: boolean[] = [];
  let ends = 0;
  const remote: (MediaStream | undefined)[] = [];
  const local: (MediaStream | undefined)[] = [];
  const wire: string[] = [];
  const call = new LiveCall({
    events: {
      onStatus: (status) => statuses.push(status),
      onCaptions: (rows) => captions.push(rows),
      onError: (message) => errors.push(message),
    },
    acts: {
      createSession: async (sdp) => {
        offers.push(sdp);
        return options.sessionCreated === false
          ? undefined
          : { sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" };
      },
      endSession: () => {
        ends += 1;
      },
      reportTransport: (state) => transports.push(state),
      reportActivity: (idle) => activity.push(idle),
    },
    createPeerConnection: () => peer,
    openMicrophone: async () => {
      if (!microphoneGranted) throw new Error("refused");
      // SAFETY: the call reads only the audio tracks and their `enabled` and `stop` off the stream.
      return stream as unknown as MediaStream;
    },
    onRemoteStream: (value) => remote.push(value),
    onLocalStream: (value) => local.push(value),
    onWireEvent: (direction, event) => wire.push(`${direction}:${String(event.type)}`),
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  const channel = () => {
    const opened = peer.channels[0];
    assert.ok(opened, "the channel was created");
    return opened;
  };
  const started = () => {
    channel().readyState = "open";
    channel().receive({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: "sess_1" },
    });
  };
  const acknowledge = (type: string) => {
    const last = channel().sent.at(-1);
    assert.ok(last, "a switch was sent");
    channel().receive({
      type,
      event_id: `ack-${channel().sent.length}`,
      client_event_id: String(last.event_id),
    });
  };
  return {
    clock,
    peer,
    track,
    call,
    statuses,
    captions,
    errors,
    offers,
    transports,
    activity,
    ends: () => ends,
    remote,
    local,
    wire,
    channel,
    started,
    acknowledge,
    grantMicrophone: () => {
      microphoneGranted = true;
    },
    sentTypes: () => channel().sent.map((event) => event.type),
  };
}

test("the peer is built in the guide's order: track, channel before the offer, ICE under its bound, the host's answer set, and started awaited", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  assert.deepEqual(f.peer.steps, ["add-track", "create-channel", "create-offer", "set-local"]);
  assert.equal(f.track.enabled, false);
  assert.equal(f.offers.length, 0);
  f.peer.gathered();
  await drainMicrotasks();
  assert.deepEqual(f.offers, ["v=0\r\noffer\r\n"]);
  assert.deepEqual(f.peer.steps.at(-1), "set-remote");
  assert.equal(f.peer.remoteSdp, "v=0\r\nanswer\r\n");
  assert.equal(f.statuses.at(-1), LIVE_STATUS.CONNECTING);
  // Nothing is sent before the server says started, and never session.start.
  assert.deepEqual(f.sentTypes(), []);
  f.started();
  assert.equal(await opening, true);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.MUTED);
  assert.equal(f.call.standing, true);
  assert.equal(f.call.listening, false);
});

test("ICE gathering that never completes sends the offer at the bound", async () => {
  const f = fixture();
  void f.call.open();
  await drainMicrotasks();
  await f.clock.advance(f.clock.now + 5_000);
  assert.equal(f.offers.length, 1);
});

test("a host that creates no session leaves the peer closed and the call failed", async () => {
  const f = fixture({ sessionCreated: false });
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  assert.equal(await opening, false);
  assert.equal(f.peer.steps.at(-1), "close");
  assert.equal(f.track.stopped, true);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.FAILED);
  assert.notEqual(f.errors.at(-1), undefined);
  assert.equal(f.call.standing, false);
});

test("a session that never announces itself started is given up at the bound", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  await f.clock.advance(f.clock.now + SESSION_START_TIMEOUT_MS);
  assert.equal(await opening, false);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.FAILED);
  assert.equal(f.peer.steps.at(-1), "close");
});

test("unmute and mute send the switch and flip the track only on the acknowledgment; an error naming the switch refuses it", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  await opening;
  const unmuting = f.call.unmute();
  await drainMicrotasks();
  assert.deepEqual(f.sentTypes(), [LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE]);
  assert.equal(f.track.enabled, false);
  f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
  assert.equal(await unmuting, true);
  assert.equal(f.track.enabled, true);
  assert.equal(f.call.listening, true);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.LISTENING);
  const muting = f.call.mute();
  await drainMicrotasks();
  assert.deepEqual(f.sentTypes().at(-1), LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE);
  assert.equal(f.track.enabled, true);
  const sent = f.channel().sent.at(-1);
  assert.ok(sent);
  f.channel().receive({
    type: LIVE_SERVER_EVENT.ERROR,
    event_id: "err-1",
    client_event_id: String(sent.event_id),
    error: { type: "invalid_request_error", message: "no" },
  });
  assert.equal(await muting, false);
  assert.equal(f.track.enabled, true);
  assert.equal(f.call.listening, true);
  // An acknowledgment that never comes gives the switch up at the bound.
  const again = f.call.mute();
  await drainMicrotasks();
  await f.clock.advance(f.clock.now + MICROPHONE_ACK_TIMEOUT_MS);
  assert.equal(await again, false);
});

test("a stop during an unmute still awaiting its acknowledgment gives the unmute up and mutes anyway", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  await opening;
  const unmuting = f.call.unmute();
  await drainMicrotasks();
  const muting = f.call.mute();
  assert.equal(await unmuting, false);
  await drainMicrotasks();
  assert.deepEqual(f.sentTypes(), [
    LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
    LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
  ]);
  f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
  assert.equal(await muting, true);
  assert.equal(f.track.enabled, false);
  assert.equal(f.call.listening, false);
});

test("a microphone the system refused rides as a trackless line and is filled by the first unmute", async () => {
  const f = fixture({ microphone: false });
  const opening = f.call.open();
  await drainMicrotasks();
  assert.deepEqual(f.peer.steps.slice(0, 2), ["add-transceiver", "create-channel"]);
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  assert.equal(await opening, true);
  assert.equal(f.local.at(-1), undefined);
  assert.equal(f.peer.replaced.length, 0);
  // Still refused at the press: the unmute cannot fill the line and sends no switch.
  assert.equal(await f.call.unmute(), false);
  assert.deepEqual(f.sentTypes(), []);
});

test("granted after the session opened, the first unmute fills the trackless line before the switch goes", async () => {
  const f = fixture({ microphone: false });
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  assert.equal(await opening, true);
  f.grantMicrophone();
  const unmuting = f.call.unmute();
  await drainMicrotasks();
  assert.equal(f.peer.replaced.length, 1);
  assert.equal(f.track.enabled, false);
  assert.deepEqual(f.sentTypes(), [LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE]);
  f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
  assert.equal(await unmuting, true);
  assert.equal(f.track.enabled, true);
});

test("the speaking status comes from the remote track's level and never from transcript events; captions draw both speakers", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  await opening;
  f.channel().receive({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: "out-1",
    delta: "Two sessions",
    start_ms: 0,
    end_ms: 800,
  });
  assert.equal(f.statuses.at(-1), LIVE_STATUS.MUTED);
  assert.equal(f.captions.at(-1)?.length, 1);
  f.call.reportRemoteAudioLevel(true);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.SPEAKING);
  f.channel().receive({
    type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
    event_id: "in-1",
    delta: "wait",
    start_ms: 500,
    end_ms: 700,
  });
  assert.deepEqual(
    f.captions.at(-1)?.map((row) => row.rowId),
    [1, 2],
  );
  // A pause in Luke's playback is held through; the status drops only after the hangover.
  f.call.reportRemoteAudioLevel(false);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.SPEAKING);
  await f.clock.advance(f.clock.now + SPEAKING_HANGOVER_MS - 1);
  f.call.reportRemoteAudioLevel(true);
  await f.clock.advance(f.clock.now + SPEAKING_HANGOVER_MS);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.SPEAKING);
  f.call.reportRemoteAudioLevel(false);
  await f.clock.advance(f.clock.now + SPEAKING_HANGOVER_MS);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.MUTED);
  assert.deepEqual(
    f.wire.slice(0, 3),
    [
      LIVE_SERVER_EVENT.SESSION_STARTED,
      LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
      LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
    ].map((type) => `${TRACE_DIRECTION.SERVER}:${type}`),
  );
});

test("the transport is reported as the peer connection moves, and a failed one ends the call", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  await opening;
  f.peer.transport("connecting");
  f.peer.transport("connected");
  f.peer.transport("disconnected");
  assert.deepEqual(f.transports, [
    LIVE_TRANSPORT_STATE.CONNECTING,
    LIVE_TRANSPORT_STATE.CONNECTED,
    LIVE_TRANSPORT_STATE.DISCONNECTED,
  ]);
  f.peer.transport("failed");
  assert.deepEqual(f.transports.slice(-2), [
    LIVE_TRANSPORT_STATE.FAILED,
    LIVE_TRANSPORT_STATE.CLOSED,
  ]);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.FAILED);
  assert.equal(f.call.standing, false);
});

test("idle is reported once after the window with no microphone activity, and cleared once on the next", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  await opening;
  await f.clock.advance(f.clock.now + LIVE_IDLE_WINDOW_MS - 1);
  assert.deepEqual(f.activity, []);
  f.call.reportMicrophoneActivity(true);
  await f.clock.advance(f.clock.now + LIVE_IDLE_WINDOW_MS - 1);
  assert.deepEqual(f.activity, []);
  await f.clock.advance(f.clock.now + 1);
  assert.deepEqual(f.activity, [true]);
  await f.clock.advance(f.clock.now + LIVE_IDLE_WINDOW_MS);
  assert.deepEqual(f.activity, [true]);
  f.call.reportMicrophoneActivity(true);
  assert.deepEqual(f.activity, [true, false]);
});

test("the hang-up registers closed, sends close, holds everything open until closed arrives, and gives up at the bound", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  await opening;
  const closing = f.call.close();
  await drainMicrotasks();
  assert.deepEqual(f.sentTypes(), [LIVE_CLIENT_EVENT.CLOSE]);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.CLOSING);
  assert.equal(f.peer.steps.includes("close"), false);
  f.channel().receive({
    type: LIVE_SERVER_EVENT.SESSION_CLOSED,
    event_id: "closed",
    reason: "close_requested",
    usage: { seconds: 42 },
  });
  await closing;
  assert.equal(f.peer.steps.at(-1), "close");
  assert.equal(f.track.stopped, true);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.IDLE);
  assert.deepEqual(f.remote.at(-1), undefined);
  // A second call with no closed event gives up at the bound.
  const g = fixture();
  const opened = g.call.open();
  await drainMicrotasks();
  g.peer.gathered();
  await drainMicrotasks();
  g.started();
  await opened;
  const abandoned = g.call.close();
  await drainMicrotasks();
  await g.clock.advance(g.clock.now + SESSION_CLOSE_TIMEOUT_MS);
  await abandoned;
  assert.equal(g.peer.steps.at(-1), "close");
  assert.equal(g.statuses.at(-1), LIVE_STATUS.IDLE);
  // The host hears the transport close on every teardown, so a session whose
  // peer gave up is one it ends rather than one left standing.
  assert.equal(g.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
  assert.equal(f.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
});

test("a channel that closes under the call ends it, and a hang-up over a channel that cannot carry it is left to the host", async () => {
  const f = fixture();
  const opening = f.call.open();
  await drainMicrotasks();
  f.peer.gathered();
  await drainMicrotasks();
  f.started();
  await opening;
  f.channel().dropped();
  assert.equal(f.call.standing, false);
  assert.equal(f.statuses.at(-1), LIVE_STATUS.IDLE);
  assert.equal(f.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
  const g = fixture();
  const opened = g.call.open();
  await drainMicrotasks();
  g.peer.gathered();
  await drainMicrotasks();
  g.started();
  await opened;
  g.channel().readyState = "closing";
  await g.call.close();
  assert.equal(g.ends(), 1);
  assert.equal(g.statuses.at(-1), LIVE_STATUS.IDLE);
});
