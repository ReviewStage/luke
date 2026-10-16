import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import type {
  AvatarSessionModule,
  PersonaCloseReason,
  PersonaSessionOptions,
  PersonaSessionSlice,
} from "@luke/ui/avatar-session-contract";
import {
  AVATAR_END_REASON,
  AVATAR_FEED_KIND,
  AVATAR_STATUS,
  type AvatarFeed,
} from "@luke/voice/avatar";
import { Deferred, Effect, Option, Queue, Stream } from "effect";
import { Base64 } from "effect/encoding";
import {
  type AvatarReport,
  type CallAvatarDoors,
  type CallAvatarTracks,
  callAvatar,
  NO_AVATAR_TRACKS,
} from "./call-avatar";

/**
 * call-avatar.test.ts -- the call window's avatar over a fake Keyframe session: the grants main hands it, the feed it maps, and the reports it makes.
 */

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar.example.test",
  participantToken: "participant-token-never-printed",
  agentIdentity: "keyframe-agent",
};

const SECOND_GRANT: AvatarGrant = { ...GRANT, participantToken: "second-token-never-printed" };

/** Keyframe's session as the SDK behaves at its edges: a room joined or refused, the calls made on it, and a close that reports itself. */
class FakePersona implements PersonaSessionSlice {
  /** Each call the window made, in order. */
  readonly calls: string[] = [];
  /** Settled once the window has asked for an interrupt. */
  readonly interrupted = Deferred.makeUnsafe<void>();
  left = false;

  constructor(
    readonly options: PersonaSessionOptions,
    private readonly refuse: boolean,
    private readonly joined: Queue.Queue<FakePersona>,
  ) {}

  connect(): Promise<void> {
    if (this.refuse) return Promise.reject(new Error("the room refused the grant"));
    Queue.offerUnsafe(this.joined, this);
    return Promise.resolve();
  }

  sendAudio(pcm: Uint8Array): void {
    this.calls.push(`sendAudio ${pcm.join(",")}`);
  }

  endAudioTurn(): Promise<void> {
    this.calls.push("endAudioTurn");
    return Promise.resolve();
  }

  interrupt(): Promise<void> {
    this.calls.push("interrupt");
    Deferred.doneUnsafe(this.interrupted, Effect.void);
    return Promise.resolve();
  }

  /** Holds `close()` open, as the SDK's does while it awaits every queued audio write. */
  flushing: Promise<void> = Promise.resolve();

  /** As the SDK's does: the close report lands after `close()` has returned. */
  close(): Promise<void> {
    if (this.left) return Promise.resolve();
    this.left = true;
    return this.flushing.then(() => this.options.onClose("client_initiated"));
  }

  serverCloses(reason: PersonaCloseReason): void {
    this.left = true;
    this.options.onClose(reason);
  }
}

/** A remote track as WebRTC hands one over: muted until media flows on it. */
class FakeTrack extends EventTarget {
  muted = true;

  firstFrame(): void {
    this.muted = false;
    this.dispatchEvent(new Event("unmute"));
  }
}

// SAFETY: the window reads only `muted` and the `unmute` event of a track, and compares it by identity.
const asTrack = (track: FakeTrack) => track as unknown as MediaStreamTrack;

/**
 * The window's avatar running over a fake bundle: the grants and feed the
 * test hands it, every report it makes, and every set of tracks it publishes.
 */
const harness = Effect.fnUntraced(function* (
  options: { refuse?: boolean; unloaded?: boolean } = {},
) {
  const grants = yield* Queue.unbounded<AvatarGrant | undefined>();
  const feeds = yield* Queue.unbounded<AvatarFeed>();
  const reports = yield* Queue.unbounded<AvatarReport>();
  const tracks = yield* Queue.unbounded<CallAvatarTracks>();
  const joined = yield* Queue.unbounded<FakePersona>();
  const module: AvatarSessionModule = {
    createSession: (made) => new FakePersona(made, options.refuse ?? false, joined),
  };
  const doors: CallAvatarDoors = {
    feeds: Stream.fromQueue(feeds),
    report: (avatar) => Queue.offer(reports, avatar),
    module: options.unloaded
      ? Effect.fail(new Error("The video could not be started."))
      : Effect.succeed(module),
  };
  yield* Effect.forkScoped(
    Stream.runForEach(callAvatar(Stream.fromQueue(grants), doors), (each) =>
      Queue.offer(tracks, each),
    ),
  );
  return { grants, feeds, reports, tracks, joined: Queue.take(joined) };
});

it.effect("a grant reports starting, then live on the video's first frame, not on its track", () =>
  Effect.gen(function* () {
    const avatar = yield* harness();
    yield* Queue.offer(avatar.grants, GRANT);
    assert.deepEqual(yield* Queue.take(avatar.reports), { status: AVATAR_STATUS.STARTING });
    const persona = yield* avatar.joined;
    const video = new FakeTrack();
    persona.options.onVideoTrack(asTrack(video));
    assert.deepEqual(yield* Queue.take(avatar.tracks), NO_AVATAR_TRACKS);
    assert.equal((yield* Queue.take(avatar.tracks)).video, asTrack(video));
    yield* Effect.yieldNow;
    assert.ok(Option.isNone(yield* Queue.poll(avatar.reports)), "live before any frame drew");
    video.firstFrame();
    const audio = new FakeTrack();
    persona.options.onAudioTrack(asTrack(audio));
    assert.deepEqual(yield* Queue.take(avatar.reports), { status: AVATAR_STATUS.LIVE });
  }).pipe(Effect.scoped),
);

it.effect("a first frame drawn before the avatar's voice arrives is not yet live", () =>
  Effect.gen(function* () {
    const avatar = yield* harness();
    yield* Queue.offer(avatar.grants, GRANT);
    assert.deepEqual(yield* Queue.take(avatar.reports), { status: AVATAR_STATUS.STARTING });
    const persona = yield* avatar.joined;
    const video = new FakeTrack();
    persona.options.onVideoTrack(asTrack(video));
    video.firstFrame();
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
    assert.ok(Option.isNone(yield* Queue.poll(avatar.reports)), "live before the voice arrived");
    persona.options.onAudioTrack(asTrack(new FakeTrack()));
    assert.deepEqual(yield* Queue.take(avatar.reports), { status: AVATAR_STATUS.LIVE });
  }).pipe(Effect.scoped),
);

it.effect(
  "the feed maps as Keyframe's bridge does: a chunk is sent, a turn ended, an interrupt ends the turn first",
  () =>
    Effect.gen(function* () {
      const avatar = yield* harness();
      const pcm = new Uint8Array([1, 0, 255, 127]);
      yield* Queue.offerAll(avatar.feeds, [
        { kind: AVATAR_FEED_KIND.AUDIO, pcm: Base64.encode(pcm) },
        { kind: AVATAR_FEED_KIND.TURN_END },
        { kind: AVATAR_FEED_KIND.INTERRUPT },
      ]);
      yield* Queue.offer(avatar.grants, GRANT);
      const persona = yield* avatar.joined;
      yield* Deferred.await(persona.interrupted);
      assert.deepEqual(persona.calls, [
        "sendAudio 1,0,255,127",
        "endAudioTurn",
        "endAudioTurn",
        "interrupt",
      ]);
    }).pipe(Effect.scoped),
);

it.effect(
  "a grant of nothing closes the session, draws no tracks, and reports nothing for the withdrawn grant",
  () =>
    Effect.gen(function* () {
      const avatar = yield* harness();
      yield* Queue.offer(avatar.grants, GRANT);
      const persona = yield* avatar.joined;
      const audio = new FakeTrack();
      persona.options.onAudioTrack(asTrack(audio));
      assert.deepEqual(yield* Queue.takeN(avatar.tracks, 2), [
        NO_AVATAR_TRACKS,
        { audio: asTrack(audio) },
      ]);
      yield* Queue.offer(avatar.grants, undefined);
      assert.equal(yield* Queue.take(avatar.tracks), NO_AVATAR_TRACKS);
      assert.ok(persona.left, "the session was left open");
      // Main withdrew the grant and knows why, so the window says nothing after starting.
      assert.deepEqual(yield* Queue.takeAll(avatar.reports), [{ status: AVATAR_STATUS.STARTING }]);
    }).pipe(Effect.scoped),
);

it.effect("the same grant handed twice opens one session", () =>
  Effect.gen(function* () {
    const avatar = yield* harness();
    yield* Queue.offerAll(avatar.grants, [GRANT, { ...GRANT }]);
    const persona = yield* avatar.joined;
    persona.serverCloses("room_deleted");
    assert.deepEqual(yield* Queue.takeN(avatar.reports, 2), [
      { status: AVATAR_STATUS.STARTING },
      { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.SERVER_CLOSED },
    ]);
    yield* Effect.yieldNow;
    assert.ok(Option.isNone(yield* Queue.poll(avatar.reports)), "a second session started");
  }).pipe(Effect.scoped),
);

for (const [closed, endReason] of [
  ["room_deleted", AVATAR_END_REASON.SERVER_CLOSED],
  ["server_shutdown", AVATAR_END_REASON.SERVER_CLOSED],
  ["participant_removed", AVATAR_END_REASON.SERVER_CLOSED],
  ["unknown", AVATAR_END_REASON.ERROR],
] as const) {
  it.effect(`Keyframe's ${closed} ends the avatar as ${endReason}`, () =>
    Effect.gen(function* () {
      const avatar = yield* harness();
      yield* Queue.offer(avatar.grants, GRANT);
      const persona = yield* avatar.joined;
      persona.serverCloses(closed);
      assert.deepEqual(yield* Queue.takeN(avatar.reports, 2), [
        { status: AVATAR_STATUS.STARTING },
        { status: AVATAR_STATUS.ENDED, endReason },
      ]);
    }).pipe(Effect.scoped),
  );
}

it.effect("a room that refuses the grant ends the avatar as an error", () =>
  Effect.gen(function* () {
    const avatar = yield* harness({ refuse: true });
    yield* Queue.offer(avatar.grants, GRANT);
    assert.deepEqual(yield* Queue.takeN(avatar.reports, 2), [
      { status: AVATAR_STATUS.STARTING },
      { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.ERROR },
    ]);
  }).pipe(Effect.scoped),
);

it.effect("a bundle that will not load ends the avatar as an error", () =>
  Effect.gen(function* () {
    const avatar = yield* harness({ unloaded: true });
    yield* Queue.offer(avatar.grants, GRANT);
    assert.deepEqual(yield* Queue.takeN(avatar.reports, 2), [
      { status: AVATAR_STATUS.STARTING },
      { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.ERROR },
    ]);
  }).pipe(Effect.scoped),
);

it.effect(
  "a withdrawn session still closing reports nothing over the next grant, whose own reports go through",
  () =>
    Effect.gen(function* () {
      const avatar = yield* harness();
      yield* Queue.offer(avatar.grants, GRANT);
      const first = yield* avatar.joined;
      const video = new FakeTrack();
      first.options.onVideoTrack(asTrack(video));
      // The first session's close is held open, as the SDK's is while it flushes queued audio.
      let flushed = () => {};
      first.flushing = new Promise<void>((resolve) => {
        flushed = resolve;
      });

      // Main has withdrawn the first grant and holds the second while the first still closes.
      yield* Queue.offerAll(avatar.grants, [undefined, SECOND_GRANT]);
      for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
      // What the first session says late: a first frame, and Keyframe's own close.
      video.firstFrame();
      first.options.onClose("room_deleted");
      flushed();
      const second = yield* avatar.joined;
      for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;

      assert.deepEqual(yield* Queue.takeAll(avatar.reports), [
        { status: AVATAR_STATUS.STARTING },
        { status: AVATAR_STATUS.STARTING },
      ]);
      second.serverCloses("room_deleted");
      assert.deepEqual(yield* Queue.take(avatar.reports), {
        status: AVATAR_STATUS.ENDED,
        endReason: AVATAR_END_REASON.SERVER_CLOSED,
      });
    }).pipe(Effect.scoped),
);
