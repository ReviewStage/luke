import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { CallAvatarRoom } from "#shared/messages/avatar-room";
import type { AvatarRoomConnection } from "../avatar-room/contract";
import { type AvatarRoomSource, type AvatarTracks, avatarRoomFeed } from "./avatar-room-feed";

const ROOM = { livekitUrl: "wss://avatar.livekit.example", viewerToken: "viewer-token" } as const;
const NEXT_ROOM = { livekitUrl: "wss://next.livekit.example", viewerToken: "next-token" } as const;

/** Lets the fake room's promises and the feed's fibers settle with no time passing. */
const settle = Effect.repeat(Effect.andThen(Effect.yieldNow, TestClock.adjust(Duration.zero)), {
  times: 8,
});

/** A remote track as the join reads one: its kind, whether its first media has arrived, and its unmute. */
function fakeTrack(kind: "video" | "audio"): MediaStreamTrack {
  // SAFETY: the join reads only `kind`, `muted`, and the unmute listener off a track.
  return Object.assign(new EventTarget(), { kind, muted: true }) as unknown as MediaStreamTrack;
}

/** LiveKit's room as the join drives it, with the avatar's two tracks already published. */
class FakeRoom implements AvatarRoomConnection {
  ontrack: ((track: MediaStreamTrack) => void) | null = null;
  ondisconnected: (() => void) | null = null;
  joined: { url: string; token: string } | undefined;
  left = false;
  readonly video = fakeTrack("video");
  readonly audio = fakeTrack("audio");

  constructor(private readonly refuse = false) {}

  connect(url: string, token: string): Promise<void> {
    if (this.refuse) return Promise.reject(new Error("refused"));
    this.joined = { url, token };
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.left = true;
    return Promise.resolve();
  }

  remoteTracks(): readonly MediaStreamTrack[] {
    return [this.video, this.audio];
  }

  drop(): void {
    this.ondisconnected?.();
  }

  firstFrame(): void {
    Object.assign(this.video, { muted: false });
    this.video.dispatchEvent(new Event("unmute"));
  }
}

/**
 * The feed over a fake bridge and fake rooms, made in order: what it answered
 * last, the rooms it made, how often main was asked, and how often the first
 * frame was reported.
 */
const feed = (rooms: FakeRoom[]) =>
  Effect.gen(function* () {
    let deliver: ((room: CallAvatarRoom | undefined) => void) | undefined;
    let asked = 0;
    let firstFrames = 0;
    const made: FakeRoom[] = [];
    const source: AvatarRoomSource = {
      subscribe: (onDelivered) => {
        deliver = onDelivered;
        return () => {
          deliver = undefined;
        };
      },
      request: () => {
        asked += 1;
      },
    };
    const answered: (AvatarTracks | undefined)[] = [];
    const fiber = yield* avatarRoomFeed(source, {
      reportFirstFrame: Effect.sync(() => {
        firstFrames += 1;
      }),
      createRoom: Effect.sync(() => {
        const room = rooms[made.length] ?? new FakeRoom();
        made.push(room);
        return room;
      }),
    }).pipe(
      Stream.runForEach((tracks) => Effect.sync(() => answered.push(tracks))),
      Effect.forkChild,
    );
    yield* settle;
    return {
      fiber,
      made,
      hand: (room: CallAvatarRoom | undefined) =>
        Effect.andThen(
          Effect.sync(() => deliver?.(room)),
          settle,
        ),
      last: () => answered.at(-1),
      asked: () => asked,
      firstFrames: () => firstFrames,
    };
  });

it.effect("asks main for the room once listening, and plays the avatar's tracks once joined", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const f = yield* feed([room]);
    assert.equal(f.asked(), 1);
    yield* f.hand(ROOM);
    assert.deepEqual(room.joined, { url: ROOM.livekitUrl, token: ROOM.viewerToken });
    assert.equal(f.last()?.video, room.video);
    assert.equal(f.last()?.audio, room.audio);
  }),
);

it.effect("reports the first frame once it draws, and only then", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const f = yield* feed([room]);
    yield* f.hand(ROOM);
    assert.equal(f.firstFrames(), 0);
    room.firstFrame();
    yield* settle;
    assert.equal(f.firstFrames(), 1);
  }),
);

it.effect("leaves the room once main hands none, and plays nothing", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const f = yield* feed([room]);
    yield* f.hand(ROOM);
    yield* f.hand(undefined);
    assert.equal(room.left, true);
    assert.equal(f.last(), undefined);
  }),
);

it.effect("leaves the last room for the next one main hands", () =>
  Effect.gen(function* () {
    const first = new FakeRoom();
    const next = new FakeRoom();
    const f = yield* feed([first, next]);
    yield* f.hand(ROOM);
    yield* f.hand(NEXT_ROOM);
    assert.equal(first.left, true);
    assert.equal(next.joined?.token, NEXT_ROOM.viewerToken);
    assert.equal(f.last()?.video, next.video);
  }),
);

it.effect("plays nothing once the room is lost from under the call", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const f = yield* feed([room]);
    yield* f.hand(ROOM);
    room.drop();
    yield* settle;
    assert.equal(f.last(), undefined);
  }),
);

it.effect("plays nothing for a room that refuses the join, and still joins the next", () =>
  Effect.gen(function* () {
    const next = new FakeRoom();
    const f = yield* feed([new FakeRoom(true), next]);
    yield* f.hand(ROOM);
    assert.equal(f.last(), undefined);
    assert.equal(f.fiber.pollUnsafe(), undefined, "the feed outlives a refused room");
    yield* f.hand(NEXT_ROOM);
    assert.equal(f.last()?.video, next.video);
  }),
);

it.effect("leaves the room when the window lets the feed go", () =>
  Effect.gen(function* () {
    const room = new FakeRoom();
    const f = yield* feed([room]);
    yield* f.hand(ROOM);
    yield* Fiber.interrupt(f.fiber);
    assert.equal(room.left, true);
  }),
);
