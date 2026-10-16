import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Scope, Stream } from "effect";
import {
  AVATAR_CLOSE_REASON,
  AVATAR_SESSION_FAILURE,
  type AvatarCloseReason,
  AvatarSessionError,
  openAvatarSession,
} from "./avatar-session.js";
import type {
  AvatarGrant,
  AvatarSessionModule,
  PersonaCloseReason,
  PersonaSessionOptions,
  PersonaSessionSlice,
} from "./avatar-session-contract.js";

/**
 * avatar-session.test.ts -- the panel's avatar over a fake Keyframe session: the tracks, the playback RPCs, and the closes, as the SDK's callbacks report them.
 */

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar.example.test",
  participantToken: "participant-token-never-printed",
  agentIdentity: "keyframe-agent",
};

/** Keyframe's session as the SDK behaves at its edges: a room joined or refused, and a close that reports itself. */
class FakePersona implements PersonaSessionSlice {
  readonly sent: Uint8Array[] = [];
  turnsEnded = 0;
  interrupts = 0;
  left = false;

  /** Whether `close()` rejects without the SDK's close report. */
  breaksOnClose = false;

  constructor(
    readonly options: PersonaSessionOptions,
    private readonly refuse: boolean,
  ) {}

  connect(): Promise<void> {
    return this.refuse
      ? Promise.reject(new Error(`could not join ${this.options.participantToken}`))
      : Promise.resolve();
  }

  sendAudio(pcm: Uint8Array): void {
    this.sent.push(pcm);
  }

  endAudioTurn(): Promise<void> {
    this.turnsEnded += 1;
    return Promise.resolve();
  }

  interrupt(): Promise<void> {
    this.interrupts += 1;
    return Promise.reject(new Error("the control channel is gone"));
  }

  /** As the SDK's does: the close report lands after `close()` has returned. */
  close(): Promise<void> {
    if (this.left) return Promise.resolve();
    this.left = true;
    if (this.breaksOnClose) return Promise.reject(new Error("the transport failed"));
    return Promise.resolve().then(() => this.options.onClose("client_initiated"));
  }

  serverCloses(reason: PersonaCloseReason): void {
    this.left = true;
    this.options.onClose(reason);
  }
}

/** A module whose sessions are fakes, and the fake it last made. */
function fakeModule(refuse = false) {
  let made: FakePersona | undefined;
  const module: AvatarSessionModule = {
    createSession: (options) => {
      made = new FakePersona(options, refuse);
      return made;
    },
  };
  return {
    module,
    persona: () => {
      assert.ok(made, "no session was created");
      return made;
    },
  };
}

// SAFETY: the session hands a track through untouched, and the test compares it by identity.
const track = (label: string) => ({ label }) as unknown as MediaStreamTrack;

it.effect("the tracks resolve to what Keyframe publishes, after the room is joined", () =>
  Effect.gen(function* () {
    const fake = fakeModule();
    const session = yield* openAvatarSession(GRANT, fake.module);
    const video = track("video");
    const audio = track("audio");
    fake.persona().options.onAudioTrack(audio);
    fake.persona().options.onVideoTrack(video);
    assert.equal(yield* session.video, video);
    assert.equal(yield* session.audio, audio);
    assert.deepEqual(
      {
        serverUrl: fake.persona().options.serverUrl,
        participantToken: fake.persona().options.participantToken,
        agentIdentity: fake.persona().options.agentIdentity,
      },
      GRANT,
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "speaking starts false and follows the playback RPCs, once per change, until the close",
  () =>
    Effect.gen(function* () {
      const fake = fakeModule();
      const session = yield* openAvatarSession(GRANT, fake.module);
      const report = fake.persona().options.onAgentStateChange;
      report("speaking");
      report("speaking");
      report("listening");
      report("speaking");
      fake.persona().serverCloses("room_deleted");
      const seen = yield* Stream.runCollect(session.speaking);
      assert.deepEqual(seen, [false, true, false, true]);
    }).pipe(Effect.scoped),
);

it.effect("closed names Keyframe's reasons as the window tells them apart", () =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<readonly [PersonaCloseReason, AvatarCloseReason]> = [
      ["room_deleted", AVATAR_CLOSE_REASON.SERVER_CLOSED],
      ["server_shutdown", AVATAR_CLOSE_REASON.SERVER_CLOSED],
      ["participant_removed", AVATAR_CLOSE_REASON.SERVER_CLOSED],
      ["unknown", AVATAR_CLOSE_REASON.ERROR],
    ];
    for (const [reason, expected] of cases) {
      const fake = fakeModule();
      const closed = yield* Effect.scoped(
        Effect.gen(function* () {
          const session = yield* openAvatarSession(GRANT, fake.module);
          fake.persona().serverCloses(reason);
          return yield* session.closed;
        }),
      );
      assert.equal(closed, expected, reason);
    }
  }),
);

it.effect("closing the scope leaves the room, and closed says this side ended it", () =>
  Effect.gen(function* () {
    const fake = fakeModule();
    const scope = yield* Scope.make();
    const session = yield* Scope.provide(openAvatarSession(GRANT, fake.module), scope);
    assert.equal(fake.persona().left, false);
    yield* Scope.close(scope, Exit.void);
    assert.equal(fake.persona().left, true);
    assert.equal(yield* session.closed, AVATAR_CLOSE_REASON.USER);
  }),
);

it.effect(
  "a close before a track arrives fails the wait on it rather than leaving it standing",
  () =>
    Effect.gen(function* () {
      const fake = fakeModule();
      const session = yield* openAvatarSession(GRANT, fake.module);
      fake.persona().options.onAudioTrack(track("audio"));
      fake.persona().serverCloses("participant_removed");
      const video = yield* Effect.flip(session.video);
      assert.deepEqual(video, new AvatarSessionError({ failure: AVATAR_SESSION_FAILURE.CLOSED }));
    }).pipe(Effect.scoped),
);

it.effect(
  "a refused grant fails with its kind alone, nothing the SDK said, and still leaves the room",
  () =>
    Effect.gen(function* () {
      const fake = fakeModule(true);
      const refused = yield* Effect.flip(Effect.scoped(openAvatarSession(GRANT, fake.module)));
      assert.deepEqual(
        refused,
        new AvatarSessionError({ failure: AVATAR_SESSION_FAILURE.CONNECT }),
      );
      assert.equal(JSON.stringify(refused).includes(GRANT.participantToken), false);
      assert.equal(fake.persona().left, true);
    }),
);

it.effect(
  "audio, a turn's end, and an interrupt reach the session, and a failed write is not the caller's",
  () =>
    Effect.gen(function* () {
      const fake = fakeModule();
      const session = yield* openAvatarSession(GRANT, fake.module);
      const chunk = new Uint8Array([1, 2, 3, 4]);
      yield* session.sendAudio(chunk);
      yield* session.endTurn;
      yield* session.interrupt;
      assert.deepEqual(fake.persona().sent, [chunk]);
      assert.equal(fake.persona().turnsEnded, 1);
      assert.equal(fake.persona().interrupts, 1);
    }).pipe(Effect.scoped),
);

it.effect(
  "a closed session is fed no further, so a running feed does not reach a room that has gone",
  () =>
    Effect.gen(function* () {
      const fake = fakeModule();
      const session = yield* openAvatarSession(GRANT, fake.module);
      yield* session.sendAudio(new Uint8Array([1, 2]));
      fake.persona().serverCloses("server_shutdown");
      yield* session.sendAudio(new Uint8Array([3, 4]));
      yield* session.endTurn;
      yield* session.interrupt;
      assert.deepEqual(fake.persona().sent, [new Uint8Array([1, 2])]);
      assert.equal(fake.persona().turnsEnded, 0);
      assert.equal(fake.persona().interrupts, 0);
    }).pipe(Effect.scoped),
);

it.effect("a close that fails without Keyframe's report still settles the waits, as an error", () =>
  Effect.gen(function* () {
    const fake = fakeModule();
    const scope = yield* Scope.make();
    const session = yield* Scope.provide(openAvatarSession(GRANT, fake.module), scope);
    fake.persona().breaksOnClose = true;
    yield* Scope.close(scope, Exit.void);
    assert.equal(yield* session.closed, AVATAR_CLOSE_REASON.ERROR);
    assert.deepEqual(
      yield* Effect.flip(session.video),
      new AvatarSessionError({ failure: AVATAR_SESSION_FAILURE.CLOSED }),
    );
  }),
);
