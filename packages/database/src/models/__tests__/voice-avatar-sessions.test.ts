import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { voiceSessions } from "../../schemas/voice.js";
import { getTestDB } from "../../testing/index.js";
import { AVATAR_END_REASON, VOICE_DELEGATION_MODE } from "../../voice-vocabulary.js";
import {
  closeAvatarSession,
  closeAvatarSessionsOfEndedCalls,
  closeOpenAvatarSessionsOf,
  openAvatarSession,
  openAvatarSessionsOf,
} from "../voice-avatar-sessions.js";

/**
 * The Keyframe avatar sessions a call showed, over a real dialect: a session
 * is closed once and its seconds written once, a call's open sessions close
 * together and leave a closed one as it was, and an account opens and reads
 * avatar sessions on its own calls alone.
 *
 * Synthetic accounts, sessions, and persona ids throughout.
 */

const STARTED_AT = new Date("2026-10-13T12:00:00.000Z");

const PERSONA_ID = "persona-stock";

/** The instant `millis` after the session started. */
const after = (millis: number) => new Date(STARTED_AT.getTime() + millis);

/** An account with one voice session of its own; answers the account and the session's row id. */
const openCall = Effect.gen(function* () {
  const db = yield* Database;
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

/** Opens an avatar session on the call at `startedAt` and answers its id. */
const openOn = (call: { userId: string; voiceSessionId: string }, startedAt = STARTED_AT) =>
  Effect.flatMap(openAvatarSession({ ...call, personaId: PERSONA_ID, startedAt }), (opened) =>
    Effect.sync(() => Option.getOrThrow(opened)),
  );

it.layer(getTestDB())("the voice avatar sessions", (it) => {
  it.effect("a session closed twice records its seconds once", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const id = yield* openOn(call);

      const first = yield* closeAvatarSession({
        id,
        endedAt: after(90_400),
        reason: AVATAR_END_REASON.USER,
      });
      const second = yield* closeAvatarSession({
        id,
        endedAt: after(600_000),
        reason: AVATAR_END_REASON.CALL_ENDED,
      });

      assert.deepEqual(first, Option.some(91), "elapsed seconds are rounded up");
      assert.deepEqual(second, Option.some(91), "a later close answers the first close's seconds");
      assert.deepEqual(yield* openAvatarSessionsOf(call), []);
    }),
  );

  it.effect("closing a session no row names answers nothing", () =>
    Effect.gen(function* () {
      const closed = yield* closeAvatarSession({
        id: randomUUID(),
        endedAt: STARTED_AT,
        reason: AVATAR_END_REASON.ERROR,
      });
      assert.deepEqual(closed, Option.none());
    }),
  );

  it.effect("a call's open sessions close together, and a closed one keeps its first close", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const neighbour = yield* openCall;
      const earlier = yield* openOn(call);
      yield* closeAvatarSession({
        id: earlier,
        endedAt: after(10_000),
        reason: AVATAR_END_REASON.SERVER_CLOSED,
      });
      yield* openOn(call, after(20_000));
      yield* openOn(neighbour);

      const closed = yield* closeOpenAvatarSessionsOf({
        voiceSessionId: call.voiceSessionId,
        endedAt: after(80_000),
        reason: AVATAR_END_REASON.ORPHANED,
      });
      const earlierAgain = yield* closeAvatarSession({
        id: earlier,
        endedAt: after(900_000),
        reason: AVATAR_END_REASON.USER,
      });

      assert.equal(closed, 1, "only the session still open is closed");
      assert.deepEqual(earlierAgain, Option.some(10), "the closed session kept its seconds");
      assert.deepEqual(yield* openAvatarSessionsOf(call), []);
      assert.equal((yield* openAvatarSessionsOf(neighbour)).length, 1, "another call is untouched");
    }),
  );

  it.effect(
    "a close bounded by an instant closes the sessions started by it, that instant's own included, and leaves the later open",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;
        yield* openOn(call);
        yield* openOn(call, after(20_000));
        const later = yield* openOn(call, after(20_001));

        const closed = yield* closeOpenAvatarSessionsOf({
          voiceSessionId: call.voiceSessionId,
          endedAt: after(40_000),
          reason: AVATAR_END_REASON.USER,
          startedBy: after(20_000),
        });

        assert.equal(closed, 2, "the session started on the bound's own millisecond is closed");
        assert.deepEqual(
          (yield* openAvatarSessionsOf(call)).map((session) => session.id),
          [later],
        );
      }),
  );

  it.effect(
    "a session left open on a call that has closed is closed as of the call's own close",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const ended = yield* openCall;
        const standing = yield* openCall;
        const stranded = yield* openOn(ended);
        yield* openOn(standing);
        yield* db
          .update(voiceSessions)
          .set({ closedAt: after(45_200) })
          .where(eq(voiceSessions.id, ended.voiceSessionId));

        const closed = yield* closeAvatarSessionsOfEndedCalls();
        const seconds = yield* closeAvatarSession({
          id: stranded,
          endedAt: after(900_000),
          reason: AVATAR_END_REASON.USER,
        });

        assert.equal(closed, 1, "a session on a call still standing stays open");
        assert.deepEqual(seconds, Option.some(46), "its seconds run to the call's close");
        assert.equal((yield* openAvatarSessionsOf(standing)).length, 1);
      }),
  );

  it.effect("a call that has closed opens no avatar session", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const call = yield* openCall;
      yield* db
        .update(voiceSessions)
        .set({ closedAt: after(10_000) })
        .where(eq(voiceSessions.id, call.voiceSessionId));

      const opened = yield* openAvatarSession({
        ...call,
        personaId: PERSONA_ID,
        startedAt: after(11_000),
      });

      assert.deepEqual(opened, Option.none());
      assert.deepEqual(yield* openAvatarSessionsOf(call), []);
    }),
  );

  it.effect("one account cannot open or read avatar sessions on another's call", () =>
    Effect.gen(function* () {
      const owner = yield* openCall;
      const other = yield* openCall;
      const id = yield* openOn(owner);

      const openedByOther = yield* openAvatarSession({
        userId: other.userId,
        voiceSessionId: owner.voiceSessionId,
        personaId: PERSONA_ID,
        startedAt: STARTED_AT,
      });

      assert.deepEqual(openedByOther, Option.none(), "another account's call opens nothing");
      assert.deepEqual(yield* openAvatarSessionsOf(owner), [
        { id, personaId: PERSONA_ID, startedAt: STARTED_AT },
      ]);
      assert.deepEqual(
        yield* openAvatarSessionsOf({ userId: other.userId, voiceSessionId: owner.voiceSessionId }),
        [],
        "another account reads none of the owner's sessions",
      );
    }),
  );
});
