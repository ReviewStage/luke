import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { db } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { voiceSessions } from "../../schemas/voice.js";
import { getTestDB } from "../../testing/index.js";
import { AVATAR_END_REASON, VOICE_DELEGATION_MODE } from "../../voice-vocabulary.js";
import {
  closeAvatarSession,
  openAvatarSession,
  openAvatarSessionsOf,
  openAvatarSessionsOfEndedCalls,
} from "../voice-avatar-sessions.js";

/**
 * The avatar sessions a call showed, over a real dialect: a session is
 * closed once and its seconds written once, and an account opens and reads
 * avatar sessions on its own calls alone.
 *
 * Synthetic accounts and sessions throughout.
 */

const STARTED_AT = new Date("2026-10-13T12:00:00.000Z");

/** An account with one voice session of its own; answers the account and the session's row id. */
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

it.layer(getTestDB())("the voice avatar sessions", (it) => {
  it.effect("a session closed twice records its seconds once", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const liveAvatarSessionId = `avatar-${randomUUID()}`;
      yield* openAvatarSession({ ...call, liveAvatarSessionId, startedAt: STARTED_AT });

      const first = yield* closeAvatarSession({
        liveAvatarSessionId,
        endedAt: new Date(STARTED_AT.getTime() + 90_400),
        reason: AVATAR_END_REASON.USER,
      });
      const second = yield* closeAvatarSession({
        liveAvatarSessionId,
        endedAt: new Date(STARTED_AT.getTime() + 600_000),
        reason: AVATAR_END_REASON.MEDIA_LOST,
      });

      assert.deepEqual(first, Option.some(91), "elapsed seconds are rounded up");
      assert.deepEqual(second, Option.some(91), "a later close answers the first close's seconds");
      assert.deepEqual(yield* openAvatarSessionsOf(call), []);
    }),
  );

  it.effect("closing a session no row names answers nothing", () =>
    Effect.gen(function* () {
      const closed = yield* closeAvatarSession({
        liveAvatarSessionId: `avatar-${randomUUID()}`,
        endedAt: STARTED_AT,
        reason: AVATAR_END_REASON.ERROR,
      });
      assert.deepEqual(closed, Option.none());
    }),
  );

  it.effect("one account cannot open or read avatar sessions on another's call", () =>
    Effect.gen(function* () {
      const owner = yield* openCall;
      const other = yield* openCall;
      const liveAvatarSessionId = `avatar-${randomUUID()}`;

      const opened = yield* openAvatarSession({
        ...owner,
        liveAvatarSessionId,
        startedAt: STARTED_AT,
      });
      const openedByOther = yield* openAvatarSession({
        userId: other.userId,
        voiceSessionId: owner.voiceSessionId,
        liveAvatarSessionId: `avatar-${randomUUID()}`,
        startedAt: STARTED_AT,
      });

      assert.ok(Option.isSome(opened));
      assert.deepEqual(openedByOther, Option.none(), "another account's call opens nothing");
      assert.deepEqual(yield* openAvatarSessionsOf(owner), [
        { liveAvatarSessionId, startedAt: STARTED_AT },
      ]);
      assert.deepEqual(
        yield* openAvatarSessionsOf({ userId: other.userId, voiceSessionId: owner.voiceSessionId }),
        [],
        "another account reads none of the owner's sessions",
      );
    }),
  );

  it.effect("a LiveAvatar session is recorded once", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const opening = {
        ...call,
        liveAvatarSessionId: `avatar-${randomUUID()}`,
        startedAt: STARTED_AT,
      };
      yield* openAvatarSession(opening);
      const again = yield* openAvatarSession(opening);

      assert.deepEqual(again, Option.none());
      assert.equal((yield* openAvatarSessionsOf(call)).length, 1);
    }),
  );

  it.effect(
    "the sessions read as left on ended calls are the open ones of closed calls alone",
    () =>
      Effect.gen(function* () {
        const ended = yield* openCall;
        const running = yield* openCall;
        const leftOpen = `avatar-${randomUUID()}`;
        const alreadyClosed = `avatar-${randomUUID()}`;
        const onRunning = `avatar-${randomUUID()}`;
        for (const liveAvatarSessionId of [leftOpen, alreadyClosed]) {
          yield* openAvatarSession({ ...ended, liveAvatarSessionId, startedAt: STARTED_AT });
        }
        yield* openAvatarSession({
          ...running,
          liveAvatarSessionId: onRunning,
          startedAt: STARTED_AT,
        });
        yield* closeAvatarSession({
          liveAvatarSessionId: alreadyClosed,
          endedAt: STARTED_AT,
          reason: AVATAR_END_REASON.USER,
        });
        yield* db
          .update(voiceSessions)
          .set({ closedAt: STARTED_AT })
          .where(eq(voiceSessions.id, ended.voiceSessionId));

        const read = yield* openAvatarSessionsOfEndedCalls({ limit: 1_000 });
        const ours = read
          .map((open) => open.liveAvatarSessionId)
          .filter((id) => [leftOpen, alreadyClosed, onRunning].includes(id));

        assert.deepEqual(ours, [leftOpen]);
      }),
  );
});
