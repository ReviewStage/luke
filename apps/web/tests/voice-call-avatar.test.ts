import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import {
  closeAvatarSession,
  openAvatarSessionsOf,
} from "@sidecar/database/models/voice-avatar-sessions";
import { user } from "@sidecar/database/schemas/auth";
import { voiceAvatarSessions, voiceSessions } from "@sidecar/database/schemas/voice";
import { getTestDB } from "@sidecar/database/testing";
import {
  AVATAR_END_REASON as AVATAR_RECORD_REASON,
  VOICE_DELEGATION_MODE,
} from "@sidecar/database/voice-vocabulary";
import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  VOICE_SERVICE_FRAME,
} from "@sidecar/hosted";
import { eq } from "drizzle-orm";
import { Deferred, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  type AvatarAnswerFrame,
  CALL_AVATAR_ENDING,
  callAvatar,
} from "../server/voice/call-avatar";
import { LIVEAVATAR_STOP_REASON, type LiveAvatarService } from "../server/voice/liveavatar";
import { type FakeLiveAvatar, fakeLiveAvatar } from "./support/voice-fakes";

/**
 * Luke's face on one call, over a real dialect and LiveAvatar played by the
 * client's test double: a face asked for is started, recorded against the
 * call, and its grant answered; it comes down at the device's ask and when
 * the call ends, its row closed with the seconds it ran; a call shows one
 * face at a time, even one an earlier connection put up; and whatever
 * LiveAvatar or the call refuses leaves no face running that nothing would
 * stop.
 *
 * Synthetic accounts and calls throughout.
 */

/** An account with one call of its own; answers the account and the call's row id. */
const openCall = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const [row] = yield* db
    .insert(voiceSessions)
    .values({
      userId,
      liveSessionId: `live-${randomUUID()}`,
      delegationMode: VOICE_DELEGATION_MODE.CLIENT,
      planId: randomUUID(),
    })
    .returning({ id: voiceSessions.id });
  assert.ok(row);
  return { userId, voiceSessionId: row.id };
});

interface Call {
  readonly userId: string;
  readonly voiceSessionId: string;
}

/** One connection's face on the call, over the LiveAvatar given, with every answer the device was sent. */
function connection(call: Call, liveAvatar: LiveAvatarService | undefined) {
  const answers: AvatarAnswerFrame[] = [];
  return Effect.map(
    callAvatar({
      liveAvatar,
      userId: call.userId,
      voiceSessionId: call.voiceSessionId,
      answer: (frame) =>
        Effect.sync(() => {
          answers.push(frame);
        }),
      log: () => undefined,
    }),
    (avatar) => ({ avatar, answers }),
  );
}

/** The LiveAvatar session ids of the faces still recorded up on the call. */
const openFaces = (call: Call) =>
  Effect.map(openAvatarSessionsOf(call), (open) => open.map((face) => face.liveAvatarSessionId));

/** Why the row of one face says it ended. */
const endReasonOf = (liveAvatarSessionId: string) =>
  Effect.map(
    db
      .select({ endReason: voiceAvatarSessions.endReason })
      .from(voiceAvatarSessions)
      .where(eq(voiceAvatarSessions.liveAvatarSessionId, liveAvatarSessionId)),
    (rows) => rows[0]?.endReason,
  );

function onlyGrant(liveAvatar: FakeLiveAvatar) {
  assert.equal(liveAvatar.granted.length, 1);
  const grant = liveAvatar.granted[0];
  assert.ok(grant);
  return grant;
}

it.layer(getTestDB())("a call's avatar", (it) => {
  it.effect("a face asked for is started, recorded against the call, and its grant answered", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const liveAvatar = fakeLiveAvatar();
      const { avatar, answers } = yield* connection(call, liveAvatar.service);

      yield* avatar.start;

      const grant = onlyGrant(liveAvatar);
      assert.deepEqual(answers, [
        {
          type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
          avatarSessionId: grant.sessionId,
          livekitUrl: grant.livekitUrl,
          viewerToken: grant.viewerToken,
          mediaUrl: grant.mediaUrl,
          maxSeconds: grant.maxSeconds,
        },
      ]);
      assert.deepEqual(yield* openFaces(call), [grant.sessionId]);
    }),
  );

  it.effect(
    "a face the device takes down is stopped, its row closed with its seconds and why, and the device answered",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;
        const liveAvatar = fakeLiveAvatar();
        const { avatar, answers } = yield* connection(call, liveAvatar.service);
        yield* avatar.start;
        const grant = onlyGrant(liveAvatar);

        yield* TestClock.adjust("90 seconds");
        yield* avatar.stop(AVATAR_STOP_REASON.MEDIA_LOST);

        assert.deepEqual(liveAvatar.stopped, [
          { sessionId: grant.sessionId, reason: LIVEAVATAR_STOP_REASON.SERVER_ERROR },
        ]);
        assert.deepEqual(yield* openFaces(call), []);
        assert.equal(yield* endReasonOf(grant.sessionId), AVATAR_RECORD_REASON.MEDIA_LOST);
        // A later close answers what the stop wrote.
        const seconds = yield* closeAvatarSession({
          liveAvatarSessionId: grant.sessionId,
          endedAt: new Date(0),
          reason: AVATAR_RECORD_REASON.ERROR,
        });
        assert.deepEqual(seconds, Option.some(90));
        assert.deepEqual(answers.at(-1), {
          type: VOICE_SERVICE_FRAME.AVATAR_ENDED,
          reason: AVATAR_STOP_REASON.MEDIA_LOST,
        });
      }),
  );

  it.effect("a second start takes the first face down, so the call shows one", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const liveAvatar = fakeLiveAvatar();
      const { avatar } = yield* connection(call, liveAvatar.service);

      yield* avatar.start;
      yield* avatar.start;

      const [first, second] = liveAvatar.granted;
      assert.ok(first && second);
      assert.deepEqual(liveAvatar.stopped, [
        { sessionId: first.sessionId, reason: LIVEAVATAR_STOP_REASON.USER_CLOSED },
      ]);
      assert.deepEqual(yield* openFaces(call), [second.sessionId]);
    }),
  );

  it.effect(
    "the call's hang-up takes down a face an earlier connection put up, and nothing starts after it",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;
        const liveAvatar = fakeLiveAvatar();
        const earlier = yield* connection(call, liveAvatar.service);
        yield* earlier.avatar.start;
        const grant = onlyGrant(liveAvatar);

        // The device re-attached on another instance, which never held the grant.
        const later = yield* connection(call, liveAvatar.service);
        yield* later.avatar.end(CALL_AVATAR_ENDING.HUNG_UP);
        yield* later.avatar.start;

        assert.deepEqual(liveAvatar.stopped, [
          { sessionId: grant.sessionId, reason: LIVEAVATAR_STOP_REASON.USER_CLOSED },
        ]);
        assert.deepEqual(yield* openFaces(call), []);
        assert.equal(yield* endReasonOf(grant.sessionId), AVATAR_RECORD_REASON.USER);
        assert.equal(liveAvatar.granted.length, 1);
        assert.deepEqual(later.answers, []);
      }),
  );

  it.effect("a hang-up that arrives while the face is starting takes it down once it stands", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const liveAvatar = fakeLiveAvatar();
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      liveAvatar.beforeGrant = Effect.andThen(
        Deferred.succeed(entered, undefined),
        Deferred.await(release),
      );
      const { avatar } = yield* connection(call, liveAvatar.service);

      const starting = yield* Effect.forkChild(avatar.start);
      yield* Deferred.await(entered);
      const ending = yield* Effect.forkChild(avatar.end(CALL_AVATAR_ENDING.CALL_CLOSED));
      // Note that the end is given every turn it could take to read the rows
      // before the start goes on, because an end not made to wait would read
      // none there and leave the face it raced running.
      yield* Effect.repeat(Effect.yieldNow, { times: 200 });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(starting);
      yield* Fiber.join(ending);

      const grant = onlyGrant(liveAvatar);
      assert.deepEqual(liveAvatar.stopped, [
        { sessionId: grant.sessionId, reason: LIVEAVATAR_STOP_REASON.USER_DISCONNECTED },
      ]);
      assert.deepEqual(yield* openFaces(call), []);
    }),
  );

  it.effect("a deployment with no LiveAvatar key answers not_configured and records nothing", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const { avatar, answers } = yield* connection(call, undefined);

      yield* avatar.start;
      yield* avatar.end(CALL_AVATAR_ENDING.HUNG_UP);

      assert.deepEqual(answers, [
        {
          type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
          reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
        },
      ]);
      assert.deepEqual(yield* openFaces(call), []);
    }),
  );

  it.effect("a start LiveAvatar refuses answers error and records nothing", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const liveAvatar = fakeLiveAvatar();
      liveAvatar.refuseStarts = true;
      const { avatar, answers } = yield* connection(call, liveAvatar.service);

      yield* avatar.start;

      assert.deepEqual(answers, [
        { type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.ERROR },
      ]);
      assert.deepEqual(yield* openFaces(call), []);
    }),
  );

  it.effect(
    "a face started on a call the account does not own is stopped at once, since no row could stop it later",
    () =>
      Effect.gen(function* () {
        const owner = yield* openCall;
        const other = yield* openCall;
        const liveAvatar = fakeLiveAvatar();
        const { avatar, answers } = yield* connection(
          { userId: other.userId, voiceSessionId: owner.voiceSessionId },
          liveAvatar.service,
        );

        yield* avatar.start;

        const grant = onlyGrant(liveAvatar);
        assert.deepEqual(liveAvatar.stopped, [
          { sessionId: grant.sessionId, reason: LIVEAVATAR_STOP_REASON.SERVER_ERROR },
        ]);
        assert.deepEqual(answers, [
          { type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.ERROR },
        ]);
        assert.deepEqual(yield* openFaces(owner), []);
      }),
  );

  it.effect("a face whose stop LiveAvatar refused stays recorded open for the sweep", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const liveAvatar = fakeLiveAvatar();
      const { avatar } = yield* connection(call, liveAvatar.service);
      yield* avatar.start;
      const grant = onlyGrant(liveAvatar);

      liveAvatar.refuseStops = true;
      yield* avatar.stop(AVATAR_STOP_REASON.USER);

      assert.deepEqual(yield* openFaces(call), [grant.sessionId]);
    }),
  );
});
