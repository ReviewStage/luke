import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import type { AvatarRoomConnection } from "./contract";
import {
  AVATAR_ROOM_FAILURE,
  AVATAR_TRACKS_TIMEOUT_MS,
  type AvatarRoomError,
  joinAvatarRoom,
} from "./join-avatar-room";

const GRANT = { url: "wss://avatar.livekit.example", token: "viewer-token" } as const;

/** Lets the fake room's promises and the join's fiber settle with no time passing. */
const settle = Effect.repeat(Effect.andThen(Effect.yieldNow, TestClock.adjust(Duration.zero)), {
  times: 6,
});

/**
 * A remote track as the join reads one: its kind, whether its first media has
 * arrived, and the unmute it fires when it does.
 */
function fakeTrack(kind: "video" | "audio", muted = true): MediaStreamTrack {
  const track = Object.assign(new EventTarget(), { kind, muted });
  // SAFETY: the join reads only `kind`, `muted`, and the unmute listener off a track.
  return track as unknown as MediaStreamTrack;
}

function unmute(track: MediaStreamTrack): void {
  Object.assign(track, { muted: false });
  track.dispatchEvent(new Event("unmute"));
}

/** LiveKit's room, as far as the join drives it: tracks are published and the room is dropped by hand. */
class FakeRoom implements AvatarRoomConnection {
  ontrack: ((track: MediaStreamTrack) => void) | null = null;
  ondisconnected: (() => void) | null = null;
  joined: { url: string; token: string } | undefined;
  left = false;
  #standing: MediaStreamTrack[] = [];

  constructor(private readonly refuse = false) {}

  connect(url: string, token: string): Promise<void> {
    if (this.refuse)
      return Promise.reject(new Error(`could not join ${url}?access_token=${token}`));
    this.joined = { url, token };
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.left = true;
    this.ondisconnected?.();
    return Promise.resolve();
  }

  remoteTracks(): readonly MediaStreamTrack[] {
    return this.#standing;
  }

  /** A track the avatar published before the join settled, which fires no subscription. */
  standing(track: MediaStreamTrack): void {
    this.#standing.push(track);
  }

  publish(track: MediaStreamTrack): void {
    this.#standing.push(track);
    this.ontrack?.(track);
  }

  drop(): void {
    this.ondisconnected?.();
  }
}

/** Joins the fake room in a scope of the test's own, so the test decides when the call's video ends. */
const join = (room: FakeRoom) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const fiber = yield* joinAvatarRoom(GRANT, Effect.succeed(room)).pipe(
      Scope.provide(scope),
      Effect.forkChild,
    );
    yield* settle;
    return { scope, fiber };
  });

it.effect("answers with the avatar's video and audio once both are published", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const video = fakeTrack("video");
    const audio = fakeTrack("audio");
    const { fiber } = yield* join(room);
    assert.deepEqual(room.joined, GRANT);
    room.publish(video);
    yield* settle;
    assert.equal(fiber.pollUnsafe(), undefined, "the join waits for the audio too");
    room.publish(audio);
    const joined = yield* Fiber.join(fiber);
    assert.equal(joined.video, video);
    assert.equal(joined.audio, audio);
  }),
);

it.effect("takes the tracks the avatar published before the join settled", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const video = fakeTrack("video");
    const audio = fakeTrack("audio");
    room.standing(video);
    room.standing(audio);
    const { fiber } = yield* join(room);
    const joined = yield* Fiber.join(fiber);
    assert.equal(joined.video, video);
    assert.equal(joined.audio, audio);
  }),
);

it.effect("settles the first frame once the video's first media arrives", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const video = fakeTrack("video");
    room.standing(video);
    room.standing(fakeTrack("audio"));
    const { fiber } = yield* join(room);
    const joined = yield* Fiber.join(fiber);
    const frame = yield* Effect.forkChild(joined.firstFrame);
    yield* settle;
    assert.equal(frame.pollUnsafe(), undefined, "no frame before the first media");
    unmute(video);
    yield* Fiber.join(frame);
    yield* joined.firstFrame;
  }),
);

it.effect("settles the first frame at once for a video already playing", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    room.standing(fakeTrack("video", false));
    room.standing(fakeTrack("audio", false));
    const { fiber } = yield* join(room);
    const joined = yield* Fiber.join(fiber);
    yield* joined.firstFrame;
  }),
);

it.effect("settles lost when the room drops from under the call", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    room.standing(fakeTrack("video"));
    room.standing(fakeTrack("audio"));
    const { fiber } = yield* join(room);
    const joined = yield* Fiber.join(fiber);
    const lost = yield* Effect.forkChild(joined.lost);
    yield* settle;
    assert.equal(lost.pollUnsafe(), undefined, "the room still stands");
    room.drop();
    yield* Fiber.join(lost);
  }),
);

it.effect("leaves the room with the scope, without reading as lost", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    room.standing(fakeTrack("video"));
    room.standing(fakeTrack("audio"));
    const { scope, fiber } = yield* join(room);
    const joined = yield* Fiber.join(fiber);
    const lost = yield* Effect.forkChild(joined.lost);
    yield* Scope.close(scope, Exit.void);
    yield* settle;
    assert.equal(room.left, true);
    assert.equal(lost.pollUnsafe(), undefined, "leaving on purpose is not a loss");
  }),
);

const failureOf = (exit: Exit.Exit<unknown, AvatarRoomError> | undefined) =>
  exit !== undefined && Exit.isFailure(exit)
    ? exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []))[0]
    : undefined;

it.effect("fails refused, carrying nothing LiveKit threw, when the room refuses the join", () =>
  Effect.gen(function* () {
    const room = new FakeRoom(true);
    const { fiber } = yield* join(room);
    const error = failureOf(fiber.pollUnsafe());
    assert.equal(error?.failure, AVATAR_ROOM_FAILURE.REFUSED);
    assert.doesNotMatch(JSON.stringify(error), /viewer-token/);
  }),
);

it.effect("fails no-tracks when the avatar does not publish within the bound, and leaves", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const { scope, fiber } = yield* join(room);
    room.publish(fakeTrack("video"));
    yield* TestClock.adjust(Duration.millis(AVATAR_TRACKS_TIMEOUT_MS));
    yield* settle;
    assert.equal(failureOf(fiber.pollUnsafe())?.failure, AVATAR_ROOM_FAILURE.NO_TRACKS);
    yield* Scope.close(scope, Exit.void);
    assert.equal(room.left, true);
  }),
);

it.effect("fails lost when the room drops before the avatar published", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const { fiber } = yield* join(room);
    room.drop();
    yield* settle;
    assert.equal(failureOf(fiber.pollUnsafe())?.failure, AVATAR_ROOM_FAILURE.LOST);
  }),
);
