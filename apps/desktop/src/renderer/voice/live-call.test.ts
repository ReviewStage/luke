import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { TRACE_DIRECTION } from "@sidecar/devtrace/vocabulary";
import { LIVE_TRANSPORT_STATE, type LiveTransportState } from "@sidecar/gateway";
import {
  LIVE_CLIENT_EVENT,
  LIVE_IDLE_WINDOW_MS,
  LIVE_SERVER_EVENT,
  LIVE_STATUS,
  type LiveStatus,
} from "@sidecar/live";
import type { LiveCaptionRow } from "@sidecar/voice/orchestrator";
import type { WireRecord } from "@sidecar/wire";
import {
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberId,
  type Runtime,
  Scope,
  TestClock,
} from "effect";
import {
  LiveCall,
  MICROPHONE_ACK_TIMEOUT_MS,
  SESSION_CLOSE_TIMEOUT_MS,
  SESSION_START_TIMEOUT_MS,
  SPEAKING_HANGOVER_MS,
} from "./live-call";
import {
  acquireLivePeer,
  LIVE_EVENTS_CHANNEL_LABEL,
  LIVE_PEER_OUTCOME,
  type LiveDataChannel,
  type LivePeerConnection,
  type LiveSilence,
  type LiveTrackSender,
} from "./live-peer";

/**
 * Lets the fibers the call forked and the fake peer's own promises settle with
 * no time passing: what the call waits on is a fiber on this test's runtime,
 * and what its peer waits on is a promise a fake resolves. Twelve turns is the
 * longest chain either has — the device, the offer, the local description, the
 * session, and the answer — with room over it, and a count too low fails every
 * run rather than one.
 */
const settle = Effect.repeatN(
  Effect.andThen(Effect.yieldNow(), TestClock.adjust(Duration.zero)),
  12,
);

/** Advances the clock the call's bounds are forked against, then lets what fell due settle. */
const advance = (delayMs: number): Effect.Effect<void> =>
  Effect.andThen(TestClock.adjust(Duration.millis(delayMs)), settle);

/** What the fake peer did, in the order it did it, so the guide's order can be asserted. */
type PeerStep =
  | "add-track"
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

/** The peer's silence, as a track the fakes can tell from any device's. */
class FakeSilence implements LiveSilence {
  readonly silentTrack = new FakeTrack();
  released = false;
  // SAFETY: the peer hands the track to the connection and compares it by identity; nothing else is read off it.
  readonly track = this.silentTrack as unknown as MediaStreamTrack;
  // SAFETY: the peer hands the stream to the connection beside its track and reads nothing off it.
  readonly stream = new FakeStream([this.silentTrack]) as unknown as MediaStream;
  release(): void {
    this.released = true;
  }
}

class FakePeerConnection implements LivePeerConnection {
  connectionState = "new";
  iceGatheringState = "gathering";
  localDescription: { sdp: string } | null = null;
  readonly steps: PeerStep[] = [];
  readonly channels: FakeChannel[] = [];
  /** The tracks put on the line: the one the offer rode, then every swap. */
  readonly added: MediaStreamTrack[] = [];
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

  addTrack(track: MediaStreamTrack): LiveTrackSender {
    this.steps.push("add-track");
    this.added.push(track);
    return this.sender;
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

function build(
  runtime: Runtime.Runtime<never>,
  options: { microphone?: boolean; sessionCreated?: boolean },
) {
  let microphoneGranted = options.microphone !== false;
  const peer = new FakePeerConnection();
  const silence = new FakeSilence();
  /** One device per open, so a release's stop and a later press's fresh device can each be told apart. */
  const tracks: FakeTrack[] = [new FakeTrack()];
  let microphoneOpens = 0;
  let devicesOpened = 0;
  let holdMicrophone: (() => void) | undefined;
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
    createSilence: () => silence,
    openMicrophone: async () => {
      microphoneOpens += 1;
      if (holdMicrophone) await new Promise<void>((resolve) => (holdMicrophone = resolve));
      if (!microphoneGranted) throw new Error("refused");
      const track = devicesOpened === 0 ? tracks[0] : new FakeTrack();
      assert.ok(track);
      if (devicesOpened > 0) tracks.push(track);
      devicesOpened += 1;
      // SAFETY: the call reads only the audio tracks and their `enabled` and `stop` off the stream.
      return new FakeStream([track]) as unknown as MediaStream;
    },
    onRemoteStream: (value) => remote.push(value),
    onLocalStream: (value) => local.push(value),
    onWireEvent: (direction, event) => wire.push(`${direction}:${String(event.type)}`),
    runtime,
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
    peer,
    silence,
    get track(): FakeTrack {
      const first = tracks[0];
      assert.ok(first);
      return first;
    },
    tracks,
    microphoneOpens: () => microphoneOpens,
    /** The next device open waits until `releaseMicrophone` lets it finish. */
    holdNextMicrophone: () => {
      holdMicrophone = () => undefined;
    },
    releaseMicrophone: () => {
      const release = holdMicrophone;
      holdMicrophone = undefined;
      release?.();
    },
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

/** One call over its own fake peer, on the test's runtime, so its bounds are this test's clock. */
const fixture = (
  options: { microphone?: boolean; sessionCreated?: boolean } = {},
): Effect.Effect<ReturnType<typeof build>> =>
  Effect.map(Effect.runtime<never>(), (runtime) => build(runtime, options));

it.effect(
  "the peer is built in the guide's order: track, channel before the offer, ICE under its bound, the host's answer set, and started awaited",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      assert.deepEqual(f.peer.steps, ["add-track", "create-channel", "create-offer", "set-local"]);
      assert.deepEqual(f.peer.added, [f.track]);
      assert.equal(f.track.enabled, false);
      assert.equal(f.offers.length, 0);
      f.peer.gathered();
      yield* settle;
      assert.deepEqual(f.offers, ["v=0\r\noffer\r\n"]);
      assert.deepEqual(f.peer.steps.at(-1), "set-remote");
      assert.equal(f.peer.remoteSdp, "v=0\r\nanswer\r\n");
      assert.equal(f.statuses.at(-1), LIVE_STATUS.CONNECTING);
      // Nothing is sent before the server says started, and never session.start.
      assert.deepEqual(f.sentTypes(), []);
      f.started();
      assert.equal(yield* Fiber.join(opening), true);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.MUTED);
      assert.equal(f.call.standing, true);
      assert.equal(f.call.listening, false);
    }),
);

it.effect("ICE gathering that never completes sends the offer at the bound", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.fork(f.call.open({ byPress: true }));
    yield* settle;
    yield* advance(5_000);
    assert.equal(f.offers.length, 1);
  }),
);

it.effect("a host that creates no session leaves the peer closed and the call failed", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ sessionCreated: false });
    const opening = yield* Effect.fork(f.call.open({ byPress: true }));
    yield* settle;
    f.peer.gathered();
    assert.equal(yield* Fiber.join(opening), false);
    yield* settle;
    assert.equal(f.peer.steps.at(-1), "close");
    assert.equal(f.track.stopped, true);
    assert.equal(f.statuses.at(-1), LIVE_STATUS.FAILED);
    assert.notEqual(f.errors.at(-1), undefined);
    assert.equal(f.call.standing, false);
  }),
);

it.effect("a session that never announces itself started is given up at the bound", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const opening = yield* Effect.fork(f.call.open({ byPress: true }));
    yield* settle;
    f.peer.gathered();
    yield* settle;
    yield* advance(SESSION_START_TIMEOUT_MS - 1);
    assert.equal(f.statuses.at(-1), LIVE_STATUS.CONNECTING);
    assert.deepEqual(f.errors, []);
    yield* advance(1);
    assert.equal(yield* Fiber.join(opening), false);
    assert.equal(f.statuses.at(-1), LIVE_STATUS.FAILED);
    yield* settle;
    assert.equal(f.peer.steps.at(-1), "close");
  }),
);

it.effect(
  "unmute and mute send the switch and flip the track only on the acknowledgment; an error naming the switch refuses it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      assert.deepEqual(f.sentTypes(), [LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE]);
      assert.equal(f.track.enabled, false);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      assert.equal(yield* Fiber.join(unmuting), true);
      assert.equal(f.track.enabled, true);
      assert.equal(f.call.listening, true);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.LISTENING);
      const muting = yield* Effect.fork(f.call.mute());
      yield* settle;
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
      assert.equal(yield* Fiber.join(muting), false);
      // Refused or not, the key is up: the device leaves the line, silence in its place, and stops.
      assert.deepEqual(f.peer.replaced, [f.silence.track]);
      assert.equal(f.track.stopped, true);
      assert.equal(f.call.listening, false);
      assert.equal(f.local.at(-1), undefined);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.MUTED);
    }),
);

it.effect(
  "the release after the acknowledgment takes the track off the line and stops the device exactly once",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      assert.equal(yield* Fiber.join(unmuting), true);
      const muting = yield* Effect.fork(f.call.mute());
      yield* settle;
      // The switch first, the device after: nothing is taken off the line while the mute is in flight.
      assert.deepEqual(f.peer.replaced, []);
      assert.equal(f.track.stopped, false);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
      assert.equal(yield* Fiber.join(muting), true);
      assert.deepEqual(f.peer.replaced, [f.silence.track]);
      assert.equal(f.track.stopped, true);
      assert.equal(f.local.at(-1), undefined);
      assert.equal(f.call.listening, false);
      // A second release finds no device and sends nothing.
      assert.equal(yield* f.call.mute(), true);
      assert.deepEqual(f.peer.replaced, [f.silence.track]);
      assert.equal(f.sentTypes().length, 2);
    }),
);

it.effect("a mute the server never acknowledges still releases the device at the bound", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const opening = yield* Effect.fork(f.call.open({ byPress: true }));
    yield* settle;
    f.peer.gathered();
    yield* settle;
    f.started();
    yield* Fiber.join(opening);
    const unmuting = yield* Effect.fork(f.call.unmute());
    yield* settle;
    f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
    yield* Fiber.join(unmuting);
    const muting = yield* Effect.fork(f.call.mute());
    yield* settle;
    yield* advance(MICROPHONE_ACK_TIMEOUT_MS);
    assert.equal(yield* Fiber.join(muting), false);
    assert.deepEqual(f.peer.replaced, [f.silence.track]);
    assert.equal(f.track.stopped, true);
    assert.equal(f.local.at(-1), undefined);
  }),
);

it.effect(
  "the next press after a release opens a fresh device and puts it on the line before the switch",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      assert.equal(f.microphoneOpens(), 1);
      const first = yield* Effect.fork(f.call.unmute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      yield* Fiber.join(first);
      const muting = yield* Effect.fork(f.call.mute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
      yield* Fiber.join(muting);
      const second = yield* Effect.fork(f.call.unmute());
      yield* settle;
      assert.equal(f.microphoneOpens(), 2);
      assert.equal(f.tracks.length, 2);
      const fresh = f.tracks[1];
      assert.ok(fresh);
      assert.deepEqual(f.peer.replaced, [f.silence.track, fresh]);
      assert.equal(fresh.enabled, false);
      assert.deepEqual(f.sentTypes().at(-1), LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      assert.equal(yield* Fiber.join(second), true);
      assert.equal(fresh.enabled, true);
      assert.equal(f.local.at(-1) !== undefined, true);
    }),
);

it.effect(
  "a release while the press's device is still opening stops that device instead of attaching it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: false }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      f.holdNextMicrophone();
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      assert.equal(f.microphoneOpens(), 1);
      const muting = yield* Effect.fork(f.call.mute());
      assert.equal(yield* Fiber.join(muting), true);
      f.releaseMicrophone();
      assert.equal(yield* Fiber.join(unmuting), false);
      assert.equal(f.track.stopped, true);
      assert.deepEqual(f.peer.replaced, []);
      assert.deepEqual(f.sentTypes(), []);
      assert.equal(f.call.listening, false);
    }),
);

it.effect(
  "a release while the press's device is being attached takes it back off the line and stops it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: false }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      let attach: (() => void) | undefined;
      f.peer.sender.replaceTrack = (track) => {
        f.peer.replaced.push(track);
        return track === f.silence.track
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              attach = resolve;
            });
      };
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      assert.deepEqual(f.peer.replaced, [f.track]);
      assert.equal(yield* f.call.mute(), true);
      attach?.();
      assert.equal(yield* Fiber.join(unmuting), false);
      assert.deepEqual(f.peer.replaced, [f.track, f.silence.track]);
      assert.equal(f.track.stopped, true);
      assert.deepEqual(f.sentTypes(), []);
      assert.equal(f.local.length, 1);
    }),
);

it.effect(
  "a press landing while the release's mute is still in flight waits for it, then opens a fresh device",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const first = yield* Effect.fork(f.call.unmute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      yield* Fiber.join(first);
      const muting = yield* Effect.fork(f.call.mute());
      yield* settle;
      const second = yield* Effect.fork(f.call.unmute());
      yield* settle;
      // Nothing of the press goes until the release has let the device go.
      assert.deepEqual(f.sentTypes(), [
        LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
        LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
      ]);
      assert.equal(f.microphoneOpens(), 1);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
      assert.equal(yield* Fiber.join(muting), true);
      yield* settle;
      assert.equal(f.track.stopped, true);
      assert.equal(f.microphoneOpens(), 2);
      const fresh = f.tracks[1];
      assert.ok(fresh);
      assert.deepEqual(f.peer.replaced, [f.silence.track, fresh]);
      assert.deepEqual(f.sentTypes().at(-1), LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      assert.equal(yield* Fiber.join(second), true);
      assert.equal(f.call.listening, true);
      assert.equal(fresh.enabled, true);
    }),
);

it.effect(
  "a press's device released before the session stood is let go of by the mute the release owes it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      assert.equal(f.track.stopped, false);
      assert.equal(yield* f.call.mute(), true);
      assert.deepEqual(f.sentTypes(), []);
      assert.deepEqual(f.peer.replaced, [f.silence.track]);
      assert.equal(f.track.stopped, true);
      assert.equal(f.local.at(-1), undefined);
    }),
);

it.effect(
  "a session opened for Luke's own speech carries no device: the silent track rides the offer and no microphone opens",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: false }));
      yield* settle;
      assert.deepEqual(f.peer.steps.slice(0, 2), ["add-track", "create-channel"]);
      assert.deepEqual(f.peer.added, [f.silence.track]);
      assert.equal(f.microphoneOpens(), 0);
      f.peer.gathered();
      yield* settle;
      f.started();
      assert.equal(yield* Fiber.join(opening), true);
      assert.equal(f.local.at(-1), undefined);
      assert.equal(f.track.stopped, false);
      // The press against it opens the device then, and only then.
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      assert.equal(f.microphoneOpens(), 1);
      assert.deepEqual(f.peer.replaced, [f.track]);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      assert.equal(yield* Fiber.join(unmuting), true);
    }),
);

it.effect("a muted session with no device still reports idle once the window passes", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const opening = yield* Effect.fork(f.call.open({ byPress: false }));
    yield* settle;
    f.peer.gathered();
    yield* settle;
    f.started();
    yield* Fiber.join(opening);
    yield* advance(LIVE_IDLE_WINDOW_MS - 1);
    assert.deepEqual(f.activity, []);
    yield* advance(1);
    assert.deepEqual(f.activity, [true]);
  }),
);

it.effect(
  "Luke's own speech on the remote track re-arms the idle window and takes back an idle already reported",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: false }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      yield* advance(LIVE_IDLE_WINDOW_MS - 1);
      f.call.reportRemoteAudioLevel(true);
      yield* advance(LIVE_IDLE_WINDOW_MS - 1);
      assert.deepEqual(f.activity, []);
      // The hangover holds the speaking status, not the idle window: quiet playback is quiet.
      f.call.reportRemoteAudioLevel(false);
      yield* advance(1);
      assert.deepEqual(f.activity, [true]);
      f.call.reportRemoteAudioLevel(true);
      assert.deepEqual(f.activity, [true, false]);
    }),
);

it.effect(
  "the sending line always carries a track: across presses and releases the sender is handed the device or the silence, never nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: false }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      for (const _ of [0, 1]) {
        const unmuting = yield* Effect.fork(f.call.unmute());
        yield* settle;
        f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
        yield* Fiber.join(unmuting);
        const muting = yield* Effect.fork(f.call.mute());
        yield* settle;
        f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
        yield* Fiber.join(muting);
      }
      const [first, second] = f.tracks;
      assert.ok(first);
      assert.ok(second);
      assert.deepEqual(f.peer.added, [f.silence.track]);
      assert.deepEqual(f.peer.replaced, [first, f.silence.track, second, f.silence.track]);
      assert.equal(f.peer.replaced.includes(null), false);
      // Each device is stopped by the release that owed it; the silence stands for the session's life.
      assert.deepEqual(
        f.tracks.map((track) => track.stopped),
        [true, true],
      );
      assert.equal(f.silence.silentTrack.stopped, false);
      assert.equal(f.silence.released, false);
    }),
);

it.effect(
  "a stop during an unmute still awaiting its acknowledgment gives the unmute up and mutes anyway",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      const muting = yield* Effect.fork(f.call.mute());
      assert.equal(yield* Fiber.join(unmuting), false);
      yield* settle;
      assert.deepEqual(f.sentTypes(), [
        LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
        LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
      ]);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
      assert.equal(yield* Fiber.join(muting), true);
      assert.equal(f.track.enabled, false);
      assert.equal(f.call.listening, false);
    }),
);

it.effect(
  "a microphone the system refused leaves the silent track on the line until an unmute can swap a device in",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture({ microphone: false });
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      assert.deepEqual(f.peer.steps.slice(0, 2), ["add-track", "create-channel"]);
      assert.deepEqual(f.peer.added, [f.silence.track]);
      f.peer.gathered();
      yield* settle;
      f.started();
      assert.equal(yield* Fiber.join(opening), true);
      assert.equal(f.local.at(-1), undefined);
      assert.equal(f.peer.replaced.length, 0);
      // Still refused at the press: the unmute cannot fill the line and sends no switch.
      assert.equal(yield* f.call.unmute(), false);
      assert.deepEqual(f.sentTypes(), []);
    }),
);

it.effect(
  "granted after the session opened, the first unmute swaps a device onto the silent line before the switch goes",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture({ microphone: false });
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      assert.equal(yield* Fiber.join(opening), true);
      f.grantMicrophone();
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      assert.equal(f.peer.replaced.length, 1);
      assert.equal(f.track.enabled, false);
      assert.deepEqual(f.sentTypes(), [LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE]);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      assert.equal(yield* Fiber.join(unmuting), true);
      assert.equal(f.track.enabled, true);
    }),
);

it.effect(
  "the speaking status comes from the remote track's level and never from transcript events; captions draw both speakers",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
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
      yield* advance(SPEAKING_HANGOVER_MS - 1);
      f.call.reportRemoteAudioLevel(true);
      yield* advance(SPEAKING_HANGOVER_MS);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.SPEAKING);
      f.call.reportRemoteAudioLevel(false);
      yield* advance(SPEAKING_HANGOVER_MS);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.MUTED);
      assert.deepEqual(
        f.wire.slice(0, 3),
        [
          LIVE_SERVER_EVENT.SESSION_STARTED,
          LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
          LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
        ].map((type) => `${TRACE_DIRECTION.SERVER}:${type}`),
      );
    }),
);

it.effect(
  "the transport is reported as the peer connection moves, and a failed one ends the call",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
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
    }),
);

it.effect(
  "idle is reported once after the window with no microphone activity, and cleared once on the next",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      yield* advance(LIVE_IDLE_WINDOW_MS - 1);
      assert.deepEqual(f.activity, []);
      f.call.reportMicrophoneActivity(true);
      yield* advance(LIVE_IDLE_WINDOW_MS - 1);
      assert.deepEqual(f.activity, []);
      yield* advance(1);
      assert.deepEqual(f.activity, [true]);
      yield* advance(LIVE_IDLE_WINDOW_MS);
      assert.deepEqual(f.activity, [true]);
      f.call.reportMicrophoneActivity(true);
      assert.deepEqual(f.activity, [true, false]);
    }),
);

it.effect(
  "the hang-up registers closed, sends close, holds everything open until closed arrives, and gives up at the bound",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const closing = yield* Effect.fork(f.call.close());
      yield* settle;
      assert.deepEqual(f.sentTypes(), [LIVE_CLIENT_EVENT.CLOSE]);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.CLOSING);
      assert.equal(f.peer.steps.includes("close"), false);
      f.channel().receive({
        type: LIVE_SERVER_EVENT.SESSION_CLOSED,
        event_id: "closed",
        reason: "close_requested",
        usage: { seconds: 42 },
      });
      yield* Fiber.join(closing);
      yield* settle;
      assert.deepEqual(
        f.peer.steps.filter((step) => step === "close"),
        ["close"],
      );
      assert.equal(f.track.stopped, true);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.IDLE);
      assert.deepEqual(f.remote.at(-1), undefined);
      // A second call with no closed event gives up at the bound.
      const g = yield* fixture();
      const opened = yield* Effect.fork(g.call.open({ byPress: true }));
      yield* settle;
      g.peer.gathered();
      yield* settle;
      g.started();
      yield* Fiber.join(opened);
      const abandoned = yield* Effect.fork(g.call.close());
      yield* settle;
      yield* advance(SESSION_CLOSE_TIMEOUT_MS);
      yield* Fiber.join(abandoned);
      yield* settle;
      assert.equal(g.peer.steps.at(-1), "close");
      assert.equal(g.statuses.at(-1), LIVE_STATUS.IDLE);
      // The host hears the transport close on every teardown, so a session whose
      // peer gave up is one it ends rather than one left standing.
      assert.equal(g.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
      assert.equal(f.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
    }),
);

it.effect(
  "a channel that closes under the call ends it, and a hang-up over a channel that cannot carry it is left to the host",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      f.channel().dropped();
      assert.equal(f.call.standing, false);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.IDLE);
      assert.equal(f.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
      const g = yield* fixture();
      const opened = yield* Effect.fork(g.call.open({ byPress: true }));
      yield* settle;
      g.peer.gathered();
      yield* settle;
      g.started();
      yield* Fiber.join(opened);
      g.channel().readyState = "closing";
      yield* g.call.close();
      assert.equal(g.ends(), 1);
      assert.equal(g.statuses.at(-1), LIVE_STATUS.IDLE);
    }),
);

it.effect(
  "the only records the call sends are the two switches and the close, in the channel's own order",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      yield* Fiber.join(unmuting);
      const muting = yield* Effect.fork(f.call.mute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
      yield* Fiber.join(muting);
      const closing = yield* Effect.fork(f.call.close());
      yield* settle;
      f.channel().receive({
        type: LIVE_SERVER_EVENT.SESSION_CLOSED,
        event_id: "closed",
        reason: "close_requested",
        usage: { seconds: 1 },
      });
      yield* Fiber.join(closing);
      // The window's whole outbound vocabulary: no session configuration, no
      // tool list, no instructions, and nothing that could carry an append.
      assert.deepEqual(f.channel().sent, [
        { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE, event_id: "peer-1" },
        { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "peer-2" },
        { type: LIVE_CLIENT_EVENT.CLOSE, event_id: "peer-3" },
      ]);
    }),
);

it.effect(
  "a session opened for Luke's own speech sends nothing until pressed, then the same switches and close a press sends",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.fork(f.call.open({ byPress: false }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      // No session configuration, tool list, or instructions crosses for a
      // session nobody pressed for: the briefing's own vocabulary is empty
      // until the developer presses.
      assert.deepEqual(f.sentTypes(), []);
      const unmuting = yield* Effect.fork(f.call.unmute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      yield* Fiber.join(unmuting);
      const muting = yield* Effect.fork(f.call.mute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
      yield* Fiber.join(muting);
      const closing = yield* Effect.fork(f.call.close());
      yield* settle;
      f.channel().receive({
        type: LIVE_SERVER_EVENT.SESSION_CLOSED,
        event_id: "closed",
        reason: "close_requested",
        usage: { seconds: 1 },
      });
      yield* Fiber.join(closing);
      assert.deepEqual(f.channel().sent, [
        { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE, event_id: "peer-1" },
        { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "peer-2" },
        { type: LIVE_CLIENT_EVENT.CLOSE, event_id: "peer-3" },
      ]);
    }),
);

it.effect(
  "the peer belongs to the scope it was acquired into: one close, whichever way the scope ends",
  () =>
    Effect.gen(function* () {
      const connection = new FakePeerConnection();
      connection.iceGatheringState = "complete";
      const track = new FakeTrack();
      const silence = new FakeSilence();
      const scope = yield* Scope.make();
      const opened = yield* Scope.extend(
        acquireLivePeer({
          createPeerConnection: () => connection,
          createSilence: () => silence,
          // SAFETY: the peer reads only the audio tracks and their `enabled` and `stop` off the stream.
          openMicrophone: async () => new FakeStream([track]) as unknown as MediaStream,
          createSession: async () => ({ sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" }),
          onRemoteStream: () => undefined,
        }),
        scope,
      );
      assert.equal(opened.outcome, LIVE_PEER_OUTCOME.OPENED);
      if (opened.outcome === LIVE_PEER_OUTCOME.OPENED) {
        assert.equal(opened.peer.silence, silence.track);
      }
      assert.equal(connection.steps.includes("close"), false);
      assert.equal(track.stopped, false);
      assert.equal(silence.released, false);
      yield* Scope.close(scope, Exit.void);
      assert.deepEqual(
        connection.steps.filter((step) => step === "close"),
        ["close"],
      );
      assert.equal(track.stopped, true);
      assert.equal(silence.released, true);
      yield* Scope.close(scope, Exit.void);
      assert.deepEqual(
        connection.steps.filter((step) => step === "close"),
        ["close"],
      );
    }),
);

it.effect("an interrupted lifecycle releases the peer its scope was holding", () =>
  Effect.gen(function* () {
    const connection = new FakePeerConnection();
    connection.iceGatheringState = "complete";
    const held = Deferred.unsafeMake<void>(FiberId.none);
    const lifecycle = yield* Effect.fork(
      Effect.scoped(
        Effect.andThen(
          acquireLivePeer({
            createPeerConnection: () => connection,
            createSilence: () => new FakeSilence(),
            createSession: async () => ({ sessionId: "sess_1", sdpAnswer: "v=0\r\nanswer\r\n" }),
            onRemoteStream: () => undefined,
          }),
          Deferred.await(held),
        ),
      ),
    );
    yield* settle;
    assert.equal(connection.steps.includes("close"), false);
    yield* Fiber.interrupt(lifecycle);
    assert.deepEqual(
      connection.steps.filter((step) => step === "close"),
      ["close"],
    );
  }),
);

it.effect(
  "a second open while the first is still negotiating answers that one rather than a peer of its own",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const first = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      const second = yield* Effect.fork(f.call.open({ byPress: true }));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      assert.equal(yield* Fiber.join(first), true);
      assert.equal(yield* Fiber.join(second), true);
      // One peer, one offer, one session: the second ask built nothing.
      assert.deepEqual(f.offers, ["v=0\r\noffer\r\n"]);
      assert.equal(f.microphoneOpens(), 1);
      assert.deepEqual(
        f.peer.steps.filter((step) => step === "create-channel"),
        ["create-channel"],
      );
      // Once it has settled, an ask reads the call's own standing.
      assert.equal(yield* f.call.open({ byPress: true }), true);
    }),
);
