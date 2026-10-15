import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LIVE_PEER_END_REASON,
  LIVE_TRANSPORT_STATE,
  type LivePeerEndReason,
  type LiveTransportState,
} from "@luke/gateway";
import { LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT, LIVE_STATUS, type LiveStatus } from "@luke/live";
import { AVATAR_FEED_KIND, AVATAR_STATUS, type AvatarFeed } from "@luke/voice/avatar";
import type { LiveCaptionRow, LiveVoiceSpeakers } from "@luke/voice/orchestrator";
import type { WireRecord } from "@luke/wire";
import { type Context, Deferred, Duration, Effect, Fiber, type Scope } from "effect";
import { TestClock } from "effect/testing";
import type { AvatarFeedOptions } from "../avatar-feed/start-avatar-feed";
import { LiveCall, type LiveStreamSlot, SESSION_CLOSE_TIMEOUT_MS } from "./live-call";
import {
  LIVE_EVENTS_CHANNEL_LABEL,
  type LiveDataChannel,
  type LivePeerConnection,
  type LiveSilence,
  type LiveTrackSender,
} from "./live-peer";
import { VOICE_ACTIVITY_HANGOVER_MS } from "./voice-level-meter";

/**
 * Lets the fibers the call forked and the fake peer's own promises settle with
 * no time passing: what the call waits on is a fiber under this test's own
 * services, and what its peer waits on is a promise a fake resolves. Twelve
 * turns is the longest chain either has — the device, the offer, the local
 * description, the session, and the answer — with room over it, and a count
 * too low fails every run rather than one.
 */
/** What every call here is opened about: the plan a press names. */
const OPENING = { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" } as const;

const settle = Effect.repeat(Effect.andThen(Effect.yieldNow, TestClock.adjust(Duration.zero)), {
  times: 12,
});

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

/** A slot as the window's atom holds it, keeping every stream shown in it in order. */
class StreamSlot implements LiveStreamSlot {
  readonly shown: (MediaStream | undefined)[] = [];
  #current: MediaStream | undefined;

  current(): MediaStream | undefined {
    return this.#current;
  }

  show(stream: MediaStream | undefined): void {
    this.#current = stream;
    this.shown.push(stream);
  }
}

/** The two slots the window shows streams in, which every call it holds shares. */
interface WindowStreams {
  remote: StreamSlot;
  local: StreamSlot;
}

interface FixtureOptions {
  microphone?: boolean;
  sessionCreated?: boolean;
  /** The session the host creates for this call's offer. */
  sessionId?: string;
  voiceSessionId?: string;
  /** The window's slots, shared with another call; a call of its own otherwise. */
  streams?: WindowStreams;
  /** Whether the call carries the avatar feed path. */
  avatar?: boolean;
}

/**
 * The tee over Luke's track, which in the window reads it through Web Audio:
 * here its feed is whatever the test hands it, for as long as its scope stands.
 */
class FakeTee {
  starts = 0;
  /** Whether the next tee fails to stand, as one whose context refuses 24 kHz does. */
  refuses = false;
  /** A tee still loading its worklet, until `loaded` lets it stand. */
  #loading: Deferred.Deferred<void> | undefined;
  #onFeed: ((feed: AvatarFeed) => void) | undefined;

  get standing(): boolean {
    return this.#onFeed !== undefined;
  }

  holdNext(): void {
    this.#loading = Deferred.makeUnsafe<void>();
  }

  loaded(): Effect.Effect<void> {
    return this.#loading ? Effect.asVoid(Deferred.succeed(this.#loading, undefined)) : Effect.void;
  }

  start(options: AvatarFeedOptions): Effect.Effect<boolean, never, Scope.Scope> {
    const loading = this.#loading;
    return Effect.andThen(
      loading ? Deferred.await(loading) : Effect.void,
      Effect.acquireRelease(
        Effect.sync(() => {
          this.starts += 1;
          if (this.refuses) return false;
          this.#onFeed = options.onFeed;
          return true;
        }),
        () => Effect.sync(() => (this.#onFeed = undefined)),
      ),
    );
  }

  /** The gate's output for one chunk or a turn's end. */
  emit(feed: AvatarFeed): void {
    this.#onFeed?.(feed);
  }
}

function build(services: Context.Context<never>, options: FixtureOptions) {
  let microphoneGranted = options.microphone !== false;
  const peer = new FakePeerConnection();
  const silence = new FakeSilence();
  /** One device per open, so a release's stop and a later press's fresh device can each be told apart. */
  const tracks: FakeTrack[] = [new FakeTrack()];
  let microphoneOpens = 0;
  let devicesOpened = 0;
  let holdMicrophone: (() => void) | undefined;
  const statuses: LiveStatus[] = [];
  const speakers: LiveVoiceSpeakers[] = [];
  const captions: (readonly LiveCaptionRow[])[] = [];
  const errors: (string | undefined)[] = [];
  const offers: string[] = [];
  const transports: LiveTransportState[] = [];
  /** The reason each end of the peer was reported under, in order. */
  const endReasons: LivePeerEndReason[] = [];
  const activity: boolean[] = [];
  let ends = 0;
  /** The session each hang-up and transport report named, in order. */
  const namedSessions: string[] = [];
  const streams = options.streams ?? { remote: new StreamSlot(), local: new StreamSlot() };
  const sessionId = options.sessionId ?? "sess_1";
  /** The element Luke plays through, as far as its `muted` goes. */
  let outputSilenced = false;
  let avatarVoiced = false;
  const tee = new FakeTee();
  /** What went to main for the call window. */
  const fed: AvatarFeed[] = [];
  const wire: string[] = [];
  const call = new LiveCall({
    events: {
      onStatus: (status, heard) => {
        statuses.push(status);
        speakers.push(heard);
      },
      onCaptions: (rows) => captions.push(rows),
      onError: (message) => errors.push(message),
    },
    acts: {
      createSession: async (sdp) => {
        offers.push(sdp);
        return options.sessionCreated === false
          ? undefined
          : {
              sessionId,
              sdpAnswer: "v=0\r\nanswer\r\n",
              ...(options.voiceSessionId === undefined
                ? undefined
                : { voiceSessionId: options.voiceSessionId }),
            };
      },
      endSession: (request) => {
        ends += 1;
        namedSessions.push(request.sessionId);
      },
      reportTransport: (report) => {
        transports.push(report.state);
        namedSessions.push(report.sessionId);
        if (report.reason !== undefined) endReasons.push(report.reason);
      },
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
    remoteStream: streams.remote,
    localStream: streams.local,
    onOutputSilenced: (silenced) => {
      outputSilenced = silenced;
    },
    ...(options.avatar === true && {
      avatarFeed: {
        acts: { feed: (feed: AvatarFeed) => fed.push(feed) },
        startTee: (teeOptions: AvatarFeedOptions) => tee.start(teeOptions),
        onAvatarVoiced: (voiced: boolean) => {
          avatarVoiced = voiced;
        },
      },
    }),
    onWireEvent: (direction, event) => wire.push(`${direction}:${String(event.type)}`),
    services,
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
      session: { id: sessionId },
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
    speakers,
    captions,
    errors,
    offers,
    transports,
    endReasons,
    activity,
    ends: () => ends,
    namedSessions,
    streams,
    remote: streams.remote.shown,
    local: streams.local.shown,
    outputSilenced: () => outputSilenced,
    avatarVoiced: () => avatarVoiced,
    tee,
    fed,
    /** Luke's track arriving on the peer, as the browser hands it up. */
    remoteTrack: () => {
      // SAFETY: the call hands the stream to its slot and its tee and reads nothing off it.
      const stream = new FakeStream([new FakeTrack()]) as unknown as MediaStream;
      // SAFETY: the peer reads only `streams` off the track event.
      peer.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent);
      return stream;
    },
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

/** One call over its own fake peer, under the test's own services, so its bounds are this test's clock. */
const fixture = (options: FixtureOptions = {}): Effect.Effect<ReturnType<typeof build>> =>
  Effect.map(Effect.context<never>(), (services) => build(services, options));

it.effect(
  "the peer is built in the guide's order: track, channel before the offer, ICE under its bound, the host's answer set, and started awaited",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.forkChild(f.call.open(OPENING));
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

it.effect(
  "unmute and mute send the switch and flip the track only on the acknowledgment; an error naming the switch refuses it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.forkChild(f.call.open(OPENING));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const unmuting = yield* Effect.forkChild(f.call.unmute());
      yield* settle;
      assert.deepEqual(f.sentTypes(), [LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE]);
      assert.equal(f.track.enabled, false);
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      assert.equal(yield* Fiber.join(unmuting), true);
      assert.equal(f.track.enabled, true);
      assert.equal(f.call.listening, true);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.LISTENING);
      const muting = yield* Effect.forkChild(f.call.mute());
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
  "the hang-up asks the service for the close, stops the microphone at once, holds the peer open until closed arrives, and gives up at the bound",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.forkChild(f.call.open(OPENING));
      yield* settle;
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      const unmuting = yield* Effect.forkChild(f.call.unmute());
      yield* settle;
      f.acknowledge(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
      yield* Fiber.join(unmuting);
      assert.equal(f.track.stopped, false);
      const sentBefore = f.sentTypes();
      const closing = yield* Effect.forkChild(f.call.close());
      yield* settle;
      // The service owns the close: the host is asked once and nothing goes
      // on the channel, while the device is stopped and off the line before
      // any answer, so waiting on the service leaves no live microphone.
      assert.deepEqual(f.sentTypes(), sentBefore);
      assert.equal(f.ends(), 1);
      assert.equal(f.track.stopped, true);
      assert.equal(f.peer.replaced.at(-1), f.silence.track);
      assert.equal(f.speakers.at(-1)?.listening, false);
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
      assert.equal(f.statuses.at(-1), LIVE_STATUS.IDLE);
      assert.deepEqual(f.remote.at(-1), undefined);
      // A second call with no closed event closes its peer at the bound, which
      // is what ends a session whose service could not be reached.
      const g = yield* fixture();
      const opened = yield* Effect.forkChild(g.call.open(OPENING));
      yield* settle;
      g.peer.gathered();
      yield* settle;
      g.started();
      yield* Fiber.join(opened);
      const abandoned = yield* Effect.forkChild(g.call.close());
      yield* settle;
      yield* advance(SESSION_CLOSE_TIMEOUT_MS - 1);
      assert.equal(g.peer.steps.includes("close"), false);
      yield* advance(1);
      yield* Fiber.join(abandoned);
      yield* settle;
      assert.equal(g.peer.steps.at(-1), "close");
      assert.equal(g.statuses.at(-1), LIVE_STATUS.IDLE);
      assert.deepEqual(g.sentTypes(), []);
      // The host hears the transport close on every teardown, so a session whose
      // peer gave up is one it ends rather than one left standing.
      assert.equal(g.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
      assert.equal(f.transports.at(-1), LIVE_TRANSPORT_STATE.CLOSED);
      // Each end names itself: the answered hang-up, and the one that gave up.
      assert.deepEqual(f.endReasons, [LIVE_PEER_END_REASON.HUNG_UP]);
      assert.deepEqual(g.endReasons, [LIVE_PEER_END_REASON.CLOSE_TIMED_OUT]);
    }),
);

const AUDIO: AvatarFeed = { kind: AVATAR_FEED_KIND.AUDIO, pcm: "AAAA" };
const TURN_END: AvatarFeed = { kind: AVATAR_FEED_KIND.TURN_END };
const INTERRUPT: AvatarFeed = { kind: AVATAR_FEED_KIND.INTERRUPT };

/** A call with the avatar feed path, standing, with Luke's track arrived. */
const standingWithAvatar = Effect.gen(function* () {
  const f = yield* fixture({ avatar: true });
  const opening = yield* Effect.forkChild(f.call.open(OPENING));
  yield* settle;
  f.remoteTrack();
  f.peer.gathered();
  yield* settle;
  f.started();
  yield* Fiber.join(opening);
  return f;
});

it.effect(
  "the avatar voices Luke from the first turn after it goes live, and gives his voice back to the element the moment it ends",
  () =>
    Effect.gen(function* () {
      const f = yield* standingWithAvatar;
      assert.equal(f.tee.standing, false);
      f.call.reportAvatarStatus(AVATAR_STATUS.STARTING);
      yield* settle;
      assert.equal(f.tee.standing, true);
      // A turn under way when the avatar goes live finishes on the element.
      f.tee.emit(AUDIO);
      f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
      f.tee.emit(AUDIO);
      f.tee.emit(TURN_END);
      assert.deepEqual(f.fed, []);
      assert.equal(f.avatarVoiced(), true);
      f.tee.emit(AUDIO);
      f.tee.emit(TURN_END);
      assert.deepEqual(f.fed, [AUDIO, TURN_END]);
      f.tee.emit(AUDIO);
      f.call.reportAvatarStatus(AVATAR_STATUS.ENDED);
      yield* settle;
      assert.equal(f.avatarVoiced(), false);
      assert.equal(f.tee.standing, false);
      assert.deepEqual(f.fed, [AUDIO, TURN_END, AUDIO]);
    }),
);

it.effect(
  "a call without the feed path stands no tee and never mutes the element for the avatar",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const opening = yield* Effect.forkChild(f.call.open(OPENING));
      yield* settle;
      f.remoteTrack();
      f.peer.gathered();
      yield* settle;
      f.started();
      yield* Fiber.join(opening);
      f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
      yield* settle;
      assert.equal(f.tee.starts, 0);
      assert.equal(f.avatarVoiced(), false);
    }),
);

it.effect("the stop's silence drops the feed, and the stop key flushes the avatar", () =>
  Effect.gen(function* () {
    const f = yield* standingWithAvatar;
    f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
    yield* settle;
    f.call.reportRemoteAudioLevel(true);
    f.tee.emit(AUDIO);
    f.call.silenceOutput();
    assert.equal(f.outputSilenced(), true);
    f.tee.emit(AUDIO);
    f.call.interruptAvatar();
    assert.deepEqual(f.fed, [AUDIO, INTERRUPT]);
    // Nothing reached the avatar since, so a second press has nothing to flush.
    f.call.interruptAvatar();
    assert.deepEqual(f.fed, [AUDIO, INTERRUPT]);
  }),
);

it.effect(
  "a held talk key flushes the avatar once Luke's track has been quiet 350 ms, and not again within a second",
  () =>
    Effect.gen(function* () {
      const f = yield* standingWithAvatar;
      f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
      yield* settle;
      f.call.reportRemoteAudioLevel(true);
      f.tee.emit(AUDIO);
      f.call.reportTalkKey(true);
      // The meter reports quiet once its own hangover has passed since Luke's last word.
      f.call.reportRemoteAudioLevel(false);
      yield* advance(350 - VOICE_ACTIVITY_HANGOVER_MS - 1);
      assert.deepEqual(f.fed, [AUDIO]);
      yield* advance(1);
      assert.deepEqual(f.fed, [AUDIO, INTERRUPT]);
      // Luke speaks again under the same hold and yields again inside the cooldown.
      f.call.reportRemoteAudioLevel(true);
      f.tee.emit(AUDIO);
      f.call.reportRemoteAudioLevel(false);
      yield* advance(350 - VOICE_ACTIVITY_HANGOVER_MS);
      assert.deepEqual(f.fed, [AUDIO, INTERRUPT, AUDIO]);
      yield* advance(1_000 - (350 - VOICE_ACTIVITY_HANGOVER_MS));
      assert.deepEqual(f.fed, [AUDIO, INTERRUPT, AUDIO, INTERRUPT]);
      // With the key up, Luke going quiet flushes nothing.
      f.call.reportTalkKey(false);
      f.call.reportRemoteAudioLevel(true);
      f.tee.emit(AUDIO);
      f.call.reportRemoteAudioLevel(false);
      yield* advance(2_000);
      assert.deepEqual(f.fed, [AUDIO, INTERRUPT, AUDIO, INTERRUPT, AUDIO]);
    }),
);

it.effect("the call's end gives Luke's voice back to the element and takes the tee down", () =>
  Effect.gen(function* () {
    const f = yield* standingWithAvatar;
    f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
    yield* settle;
    assert.equal(f.avatarVoiced(), true);
    f.channel().dropped();
    yield* settle;
    assert.equal(f.avatarVoiced(), false);
    assert.equal(f.tee.standing, false);
  }),
);

it.effect("Luke stays on the element where the tee could not stand", () =>
  Effect.gen(function* () {
    const f = yield* standingWithAvatar;
    f.tee.refuses = true;
    f.call.reportAvatarStatus(AVATAR_STATUS.STARTING);
    f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
    yield* settle;
    assert.equal(f.tee.starts, 1);
    assert.equal(f.avatarVoiced(), false);
  }),
);

it.effect(
  "a live avatar waits for the tee to stand, and a turn the meter hears then finishes on the element",
  () =>
    Effect.gen(function* () {
      const f = yield* standingWithAvatar;
      f.tee.holdNext();
      f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
      yield* settle;
      assert.equal(f.avatarVoiced(), false);
      f.call.reportRemoteAudioLevel(true);
      yield* f.tee.loaded();
      yield* settle;
      assert.equal(f.tee.standing, true);
      // The tee met Luke mid-turn: the rest of it, and its end, stay on the element.
      f.tee.emit(AUDIO);
      f.tee.emit(TURN_END);
      assert.deepEqual(f.fed, []);
      assert.equal(f.avatarVoiced(), true);
      f.tee.emit(AUDIO);
      assert.deepEqual(f.fed, [AUDIO]);
    }),
);

it.effect(
  "a tee standing in the pause after Luke's last word meets no turn, and feeds his next one",
  () =>
    Effect.gen(function* () {
      const f = yield* standingWithAvatar;
      f.call.reportRemoteAudioLevel(true);
      f.call.reportRemoteAudioLevel(false);
      // Quiet past the gate's 800 ms, the meter's own hangover counted in, yet
      // still speaking by the status's longer hangover.
      yield* advance(800 - VOICE_ACTIVITY_HANGOVER_MS);
      assert.equal(f.statuses.at(-1), LIVE_STATUS.SPEAKING);
      f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
      yield* settle;
      assert.equal(f.avatarVoiced(), true);
      f.tee.emit(AUDIO);
      f.tee.emit(TURN_END);
      assert.deepEqual(f.fed, [AUDIO, TURN_END]);
    }),
);

it.effect(
  "a tee standing in a pause inside Luke's turn leaves the rest of that turn on the element",
  () =>
    Effect.gen(function* () {
      const f = yield* standingWithAvatar;
      f.call.reportRemoteAudioLevel(true);
      f.call.reportRemoteAudioLevel(false);
      yield* advance(800 - VOICE_ACTIVITY_HANGOVER_MS - 1);
      f.call.reportAvatarStatus(AVATAR_STATUS.LIVE);
      yield* settle;
      assert.equal(f.avatarVoiced(), false);
      f.tee.emit(AUDIO);
      f.tee.emit(TURN_END);
      assert.deepEqual(f.fed, []);
      assert.equal(f.avatarVoiced(), true);
    }),
);
