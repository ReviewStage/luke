import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import {
  openAvatarSession,
  openAvatarSessionsOf,
} from "@sidecar/database/models/voice-avatar-sessions";
import { voiceSessionRecord } from "@sidecar/database/models/voice-session-record";
import { user } from "@sidecar/database/schemas/auth";
import { voiceAvatarSessions, voiceSessions } from "@sidecar/database/schemas/voice";
import { getTestDB } from "@sidecar/database/testing";
import { AVATAR_END_REASON, VOICE_DELEGATION_MODE } from "@sidecar/database/voice-vocabulary";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { eq } from "drizzle-orm";
import { Effect, Layer, Redacted, Schema } from "effect";
import { LIVEAVATAR_STOP_REASON, LiveAvatar } from "../server/voice/liveavatar";
import { createLiveUpstream } from "../server/voice/openai";
import {
  NOTHING_ORPHANED,
  sweepVoiceOrphans,
  VOICE_DETACH_GRACE_MS,
} from "../server/voice/orphan-sweep";
import { startFakeOpenAi } from "./support/voice-fakes";

/**
 * The sweep over detached voice sessions, as it lets go of an orphan's
 * avatar: each avatar session still open on the call is stopped at a
 * LiveAvatar answering from the test, and its row closed as its media lost,
 * over a real dialect. OpenAI answers every attach as gone, so each call is
 * closed as lost and no sweep reads it twice.
 *
 * Synthetic accounts and sessions throughout.
 */

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const DETACHED_AT = new Date(NOW - 2 * VOICE_DETACH_GRACE_MS);
const AVATAR_STARTED_AT = new Date(NOW - 5 * 60_000);
const HTTP_GONE = 404;

/** What a stop names, as LiveAvatar reads its body. */
const decodeStopBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ session_id: Schema.String, reason: Schema.String })),
);

interface StopSent {
  readonly sessionId: string;
  readonly reason: string;
}

/** A LiveAvatar answering every stop with the status given, recording what each stop named. */
function liveAvatarAnswering(status: number) {
  const stops: StopSent[] = [];
  const client = fakeHttpClientLayer((_url, init) => {
    const body = decodeStopBody(String(init.body));
    stops.push({ sessionId: body.session_id, reason: body.reason });
    return new Response(JSON.stringify({ code: 100, data: null }), { status });
  });
  const layer = LiveAvatar.layer({
    apiKey: Redacted.make("la-key-test"),
    avatarId: "avatar-test",
    baseUrl: "https://liveavatar.test",
  }).pipe(Layer.provide(client));
  return { stops, service: Effect.provide(Effect.service(LiveAvatar), layer) };
}

/** An account with one call of its own and an avatar open on it; answers both, the call detached past the grace where asked. */
const callWithAvatar = (options: { readonly detached: boolean }) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const [row] = yield* db
      .insert(voiceSessions)
      .values({
        userId,
        liveSessionId: `live-${randomUUID()}`,
        delegationMode: VOICE_DELEGATION_MODE.CLIENT,
        planId: randomUUID(),
        detachedAt: options.detached ? DETACHED_AT : null,
      })
      .returning({ id: voiceSessions.id });
    assert.ok(row);
    const call = { userId, voiceSessionId: row.id };
    const liveAvatarSessionId = `avatar-${randomUUID()}`;
    yield* openAvatarSession({ ...call, liveAvatarSessionId, startedAt: AVATAR_STARTED_AT });
    return { call, liveAvatarSessionId };
  });

const endReasonOf = (liveAvatarSessionId: string) =>
  Effect.map(
    db
      .select({ endReason: voiceAvatarSessions.endReason })
      .from(voiceAvatarSessions)
      .where(eq(voiceAvatarSessions.liveAvatarSessionId, liveAvatarSessionId)),
    (rows) => rows[0]?.endReason,
  );

/** One sweep at `NOW` over an OpenAI that answers every attach as gone, with the LiveAvatar client given. */
const sweepWith = (
  avatar: Effect.Success<ReturnType<typeof liveAvatarAnswering>["service"]> | undefined,
) =>
  Effect.gen(function* () {
    const openAi = yield* Effect.acquireRelease(
      Effect.promise(() => startFakeOpenAi()),
      (fake) => Effect.promise(() => fake.close()),
    );
    openAi.attachStatus = HTTP_GONE;
    return yield* sweepVoiceOrphans(
      {
        upstream: createLiveUpstream({ apiKey: "sk-test", baseUrl: openAi.baseUrl }),
        record: voiceSessionRecord(() => NOW),
        recordSeconds: () => Effect.die("no call answers session.closed here"),
        avatar,
      },
      { now: NOW },
    );
  }).pipe(Effect.scoped);

it.layer(getTestDB())("the voice orphan sweep's avatars", (it) => {
  it.effect(
    "an orphan's avatar is stopped at LiveAvatar and its row closed as its media lost",
    () =>
      Effect.gen(function* () {
        const orphan = yield* callWithAvatar({ detached: true });
        const liveAvatar = liveAvatarAnswering(200);

        const outcome = yield* sweepWith(yield* liveAvatar.service);

        assert.deepEqual(liveAvatar.stops, [
          {
            sessionId: orphan.liveAvatarSessionId,
            reason: LIVEAVATAR_STOP_REASON.ZOMBIE_SESSION_REAP,
          },
        ]);
        assert.deepEqual(yield* openAvatarSessionsOf(orphan.call), []);
        assert.equal(yield* endReasonOf(orphan.liveAvatarSessionId), AVATAR_END_REASON.MEDIA_LOST);
        assert.deepEqual(outcome, { ...NOTHING_ORPHANED, lost: 1, avatarsClosed: 1 });
      }),
  );

  it.effect("an avatar LiveAvatar no longer knows counts as already ended", () =>
    Effect.gen(function* () {
      const orphan = yield* callWithAvatar({ detached: true });

      const outcome = yield* sweepWith(yield* liveAvatarAnswering(HTTP_GONE).service);

      assert.equal(yield* endReasonOf(orphan.liveAvatarSessionId), AVATAR_END_REASON.MEDIA_LOST);
      assert.deepEqual(outcome, { ...NOTHING_ORPHANED, lost: 1, avatarsClosed: 1 });
    }),
  );

  it.effect("a stop LiveAvatar refuses leaves the avatar's row open and still ends the call", () =>
    Effect.gen(function* () {
      const orphan = yield* callWithAvatar({ detached: true });

      const outcome = yield* sweepWith(yield* liveAvatarAnswering(500).service);

      assert.equal(yield* endReasonOf(orphan.liveAvatarSessionId), null);
      assert.deepEqual(outcome, { ...NOTHING_ORPHANED, lost: 1, avatarsLeftOpen: 1 });
    }),
  );

  it.effect("without the LiveAvatar key the rows are closed all the same", () =>
    Effect.gen(function* () {
      const orphan = yield* callWithAvatar({ detached: true });

      const outcome = yield* sweepWith(undefined);

      assert.equal(yield* endReasonOf(orphan.liveAvatarSessionId), AVATAR_END_REASON.MEDIA_LOST);
      assert.deepEqual(outcome, { ...NOTHING_ORPHANED, lost: 1, avatarsClosed: 1 });
    }),
  );

  it.effect("one account's orphan never stops or closes another account's avatar", () =>
    Effect.gen(function* () {
      const orphan = yield* callWithAvatar({ detached: true });
      const other = yield* callWithAvatar({ detached: false });
      const liveAvatar = liveAvatarAnswering(200);

      yield* sweepWith(yield* liveAvatar.service);

      assert.deepEqual(
        liveAvatar.stops.map((stop) => stop.sessionId),
        [orphan.liveAvatarSessionId],
      );
      assert.deepEqual(
        (yield* openAvatarSessionsOf(other.call)).map((open) => open.liveAvatarSessionId),
        [other.liveAvatarSessionId],
      );
    }),
  );
});
