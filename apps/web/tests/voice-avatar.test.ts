import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { openAvatarSession } from "@sidecar/database/models/voice-avatar-sessions";
import { voiceSessionRecord } from "@sidecar/database/models/voice-session-record";
import { voiceAvatarSessions } from "@sidecar/database/schemas/voice";
import { AVATAR_END_REASON } from "@sidecar/database/voice-vocabulary";
import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  avatarStartedFrameFromWire,
  avatarUnavailableFrameFromWire,
  sessionCreatedFrameFromWire,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import { LIVE_DEFAULTS } from "@sidecar/live";
import { isRecord, unparsedWire, type WireRecord } from "@sidecar/wire";
import { asc, eq } from "drizzle-orm";
import { Effect, Exit, Layer, Option, Scope } from "effect";
import { afterAll } from "vitest";
import { LIVE_SERVER_EVENT, LIVE_VOICE } from "../server/live";
import {
  type AvatarGrant,
  KEYFRAME_FAILURE,
  Keyframe,
  KeyframeError,
} from "../server/voice/keyframe";
import { LOG_EVENT, type LogEntry } from "../server/voice/log";
import { createLiveUpstream } from "../server/voice/openai";
import { sweepVoiceOrphans, VOICE_DETACH_GRACE_MS } from "../server/voice/orphan-sweep";
import { listening, VoiceService, voiceServer } from "../server/voice/service";
import { SOCKET_CLOSE_CODE } from "../server/voice/socket";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  connect,
  fakeAccounts,
  hangUpDevice,
  readSocket,
  type SocketReader,
  send,
  sendText,
  startFakeOpenAi,
} from "./support/voice-fakes";
import { startPlan } from "./support/workspaces";

/**
 * The call's Keyframe avatar on the sessions route, over the real store on
 * PGlite, a fake OpenAI at the far end of the sideband, and Keyframe doubled
 * at its own seam, a test `Layer` on the `Keyframe` service. What these hold
 * to: a start is answered with a grant minted for it and its request id
 * echoed, and opens a row; a deployment with no Keyframe key, or a Keyframe
 * with no room, answers unavailable and opens none; a second start closes the
 * first's row and mints afresh; a stop closes the row its request opened,
 * and the hang-up every row still open; no avatar frame reaches OpenAI, and
 * no log line carries the grant. The orphan sweep closes an orphan's avatar
 * rows behind its voice row. Every row is an account's this test created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const API_KEY = "sk-test-project-key";
const BEARER = "Bearer account-token-1";
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const PERSONA_ID = "persona-stock-1";
const ROOM_HOST = "luke-avatar.livekit.test";
const PARTICIPANT_TOKEN = "eyJhbGciOiJIUzI1NiJ9.participant-grant-secret.signature";
/** How long a frame is waited on where none is expected, before its absence counts. */
const QUIET_MS = 150;

const GRANT: AvatarGrant = {
  serverUrl: `wss://${ROOM_HOST}`,
  participantToken: PARTICIPANT_TOKEN,
  agentIdentity: "keyframe-agent-1",
};

/** A Keyframe answering each mint with the next scripted answer, a grant once the script runs out. */
function scriptedKeyframe(script: Array<Effect.Effect<AvatarGrant, KeyframeError>> = []) {
  const minted = { count: 0 };
  const layer = Layer.succeed(Keyframe, {
    createSession: () =>
      Effect.suspend(() => {
        minted.count += 1;
        return script.shift() ?? Effect.succeed(GRANT);
      }),
  });
  return { layer, minted };
}

function record(text: string): WireRecord {
  const value = unparsedWire(JSON.parse(text));
  assert.ok(isRecord(value));
  return value;
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what}`);
}

interface Stand {
  readonly log: LogEntry[];
  url(path: string): string;
  stop(): Promise<void>;
  readonly openAi: Awaited<ReturnType<typeof startFakeOpenAi>>;
  readonly planId: string;
}

/** The service for one account holding one plan, with the avatar on the Keyframe given, or none. */
async function stand(keyframe: Layer.Layer<Keyframe> | undefined): Promise<Stand> {
  const userId = await database.createUser();
  const plan = await database.run(startPlan(userId, { name: "Teammate invitations" }));
  const openAi = await startFakeOpenAi();
  const log: LogEntry[] = [];
  const voice = voiceServer();
  const scope = await database.run(Scope.make());
  const port = await database.run(
    Scope.provide(
      Effect.gen(function* () {
        const listener = yield* listening(voice, 0, "127.0.0.1");
        yield* VoiceService.make({
          server: voice,
          apiKey: API_KEY,
          accounts: { ...fakeAccounts(), resolveUserId: () => Effect.succeedSome(userId) },
          record: voiceSessionRecord(),
          openAiBaseUrl: openAi.baseUrl,
          log: (entry) => {
            log.push(entry);
          },
          closeTimeoutMs: 300,
          firstFrameTimeoutMs: 1_000,
          attachTimeoutMs: 2_000,
          avatar: keyframe === undefined ? undefined : { keyframe, personaId: PERSONA_ID },
        });
        return listener;
      }),
      scope,
    ),
  );
  return {
    log,
    openAi,
    planId: plan.id,
    url: (path) => `ws://127.0.0.1:${port}${path}`,
    stop: async () => {
      await database.run(Scope.close(scope, Exit.void));
      await openAi.close();
    },
  };
}

/** A signed-in desktop through to a standing call, with the store's id for its row. */
async function openSession(context: Stand) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input: [],
    planId: context.planId,
  });
  const attach = await context.openAi.nextAttach();
  const upstream = readSocket(attach.socket);
  const created = sessionCreatedFrameFromWire(record(await desktop.next()));
  assert.ok(created?.voiceSessionId);
  return { desktop, upstream, attach, voiceSessionId: created.voiceSessionId };
}

const askStart = (desktop: SocketReader, requestId: string) =>
  send(desktop.socket, { type: VOICE_SERVICE_FRAME.AVATAR_START, requestId });

/** The call's avatar rows, oldest first, as the account's history reads them. */
async function avatarRows(voiceSessionId: string) {
  return database.run(
    Database.use((db) =>
      db
        .select({
          personaId: voiceAvatarSessions.personaId,
          endReason: voiceAvatarSessions.endReason,
        })
        .from(voiceAvatarSessions)
        .where(eq(voiceAvatarSessions.voiceSessionId, voiceSessionId))
        .orderBy(asc(voiceAvatarSessions.startedAt)),
    ),
  );
}

/** The desktop hangs up and OpenAI confirms the close, which the service reports as the session's end. */
async function hangUp(context: Stand, session: Awaited<ReturnType<typeof openSession>>) {
  await hangUpDevice(session.desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  await sendText(
    session.attach.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason: "close_requested",
      usage: { seconds: 4 },
    }),
  );
  await until(
    () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
    "the session to be reported ended",
  );
}

it.effect(
  "a start is answered with a grant minted for it and its request id echoed, opens a row, reaches no OpenAI, and leaves no log line carrying the grant",
  () =>
    Effect.promise(async () => {
      const keyframe = scriptedKeyframe();
      const context = await stand(keyframe.layer);
      const session = await openSession(context);

      await askStart(session.desktop, "request-1");
      const started = avatarStartedFrameFromWire(record(await session.desktop.next()));
      assert.deepEqual(started, {
        type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
        requestId: "request-1",
        ...GRANT,
      });
      assert.deepEqual(await avatarRows(session.voiceSessionId), [
        { personaId: PERSONA_ID, endReason: null },
      ]);
      // The ask went to the service and nowhere past it.
      assert.equal(await session.upstream.arrives(QUIET_MS), false);
      // The log names the room's host and nothing of the grant that joins it.
      assert.ok(
        context.log.some(
          (entry) => entry.event === LOG_EVENT.AVATAR_STARTED && entry.host === ROOM_HOST,
        ),
      );
      await hangUp(context, session);
      assert.equal(JSON.stringify(context.log).includes(PARTICIPANT_TOKEN), false);
      await context.stop();
    }),
);

it.effect(
  "a deployment with no Keyframe key answers not configured, and a Keyframe with no room or no plan for it answers unavailable, opening no row",
  () =>
    Effect.promise(async () => {
      const unconfigured = await stand(undefined);
      const call = await openSession(unconfigured);
      await askStart(call.desktop, "request-1");
      assert.deepEqual(avatarUnavailableFrameFromWire(record(await call.desktop.next())), {
        type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
        requestId: "request-1",
        reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
      });
      assert.deepEqual(await avatarRows(call.voiceSessionId), []);
      await unconfigured.stop();

      const keyframe = scriptedKeyframe([
        Effect.fail(new KeyframeError({ failure: KEYFRAME_FAILURE.NO_CAPACITY, status: 503 })),
        Effect.fail(new KeyframeError({ failure: KEYFRAME_FAILURE.PLAN_REFUSED, status: 403 })),
        Effect.fail(new KeyframeError({ failure: KEYFRAME_FAILURE.UPSTREAM })),
      ]);
      const refusing = await stand(keyframe.layer);
      const session = await openSession(refusing);
      const answered = [];
      for (const requestId of ["request-busy", "request-plan", "request-upstream"]) {
        await askStart(session.desktop, requestId);
        answered.push(avatarUnavailableFrameFromWire(record(await session.desktop.next())));
      }
      assert.deepEqual(
        answered.map((frame) => [frame?.requestId, frame?.reason]),
        [
          ["request-busy", AVATAR_UNAVAILABLE_REASON.NO_CAPACITY],
          ["request-plan", AVATAR_UNAVAILABLE_REASON.ERROR],
          ["request-upstream", AVATAR_UNAVAILABLE_REASON.ERROR],
        ],
      );
      assert.deepEqual(await avatarRows(session.voiceSessionId), []);
      await refusing.stop();
    }),
);

it.effect(
  "a second start closes the first's row and mints a grant of its own, and a stop closes the row its request opened with the desktop's reason",
  () =>
    Effect.promise(async () => {
      const keyframe = scriptedKeyframe();
      const context = await stand(keyframe.layer);
      const session = await openSession(context);

      await askStart(session.desktop, "request-1");
      await session.desktop.next();
      await askStart(session.desktop, "request-2");
      const second = avatarStartedFrameFromWire(record(await session.desktop.next()));
      assert.equal(second?.requestId, "request-2");
      assert.equal(keyframe.minted.count, 2);
      assert.deepEqual(
        (await avatarRows(session.voiceSessionId)).map((row) => row.endReason),
        [AVATAR_END_REASON.USER, null],
      );

      // A late stop for the first request closes nothing; the second's own stop closes its row.
      for (const [requestId, reason] of [
        ["request-1", AVATAR_STOP_REASON.USER],
        ["request-2", AVATAR_STOP_REASON.SERVER_CLOSED],
      ] as const) {
        await send(session.desktop.socket, {
          type: VOICE_SERVICE_FRAME.AVATAR_STOP,
          requestId,
          reason,
        });
      }
      await askStart(session.desktop, "request-3");
      await session.desktop.next();
      assert.deepEqual(
        (await avatarRows(session.voiceSessionId)).map((row) => row.endReason),
        [AVATAR_END_REASON.USER, AVATAR_END_REASON.SERVER_CLOSED, null],
      );
      await hangUp(context, session);
      await context.stop();
    }),
);

it.effect("the hang-up closes the avatar the call still shows as the call's end", () =>
  Effect.promise(async () => {
    const context = await stand(scriptedKeyframe().layer);
    const session = await openSession(context);
    await askStart(session.desktop, "request-1");
    await session.desktop.next();

    await hangUp(context, session);
    assert.deepEqual(
      (await avatarRows(session.voiceSessionId)).map((row) => row.endReason),
      [AVATAR_END_REASON.CALL_ENDED],
    );
    await context.stop();
  }),
);

it.effect(
  "the orphan sweep closes an orphan's open avatar rows as orphaned behind its voice row",
  () =>
    Effect.promise(async () => {
      const startedAt = 1_800_000_000_000;
      const record = voiceSessionRecord(() => startedAt);
      const userId = await database.createUser();
      const plan = await database.run(startPlan(userId, { name: "Teammate invitations" }));
      const sessionId = `live_orphan_${userId}`;
      const voiceSessionId = await database.run(
        record.register({
          userId,
          sessionId,
          planId: plan.id,
          attachId: "attach-1",
          model: LIVE_DEFAULTS.MODEL,
        }),
      );
      assert.ok(voiceSessionId);
      await database.run(record.detach({ sessionId, attachId: "attach-1" }));
      const opened = await database.run(
        openAvatarSession({
          userId,
          voiceSessionId,
          personaId: PERSONA_ID,
          startedAt: new Date(startedAt),
        }),
      );
      assert.ok(Option.isSome(opened));

      // OpenAI answers the attach for the session as gone, so the sweep closes it as lost.
      const openAi = await startFakeOpenAi();
      openAi.attachStatus = 404;
      await database.run(
        sweepVoiceOrphans(
          {
            upstream: createLiveUpstream({ apiKey: API_KEY, baseUrl: openAi.baseUrl }),
            record,
            recordSeconds: () => Effect.die(new Error("a lost session records no seconds")),
          },
          { now: startedAt + VOICE_DETACH_GRACE_MS + 1 },
        ),
      );
      await openAi.close();
      assert.deepEqual(
        (await avatarRows(voiceSessionId)).map((row) => row.endReason),
        [AVATAR_END_REASON.ORPHANED],
      );
    }),
);
