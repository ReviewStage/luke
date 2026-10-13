import assert from "node:assert/strict";
import { createPlan } from "@sidecar/database/models/plan-store";
import { openAvatarSessionsOf } from "@sidecar/database/models/voice-avatar-sessions";
import { voiceSessionRecord } from "@sidecar/database/models/voice-session-record";
import {
  AVATAR_UNAVAILABLE_REASON,
  avatarStartedFrameFromWire,
  avatarUnavailableFrameFromWire,
  sessionCreatedFrameFromWire,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { isRecord, unparsedWire, type WireRecord } from "@sidecar/wire";
import { Effect, Exit, type Layer, Scope } from "effect";
import { afterAll, onTestFinished, test } from "vitest";
import { LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT, LIVE_VOICE } from "../server/live";
import { LIVEAVATAR_STOP_REASON, type LiveAvatar } from "../server/voice/liveavatar";
import { listening, VoiceService, voiceServer } from "../server/voice/service";
import { SOCKET_CLOSE_CODE } from "../server/voice/socket";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  connect,
  FAKE_BEARER,
  fakeAccounts,
  fakeLiveAvatar,
  hangUpDevice,
  readSocket,
  send,
  sendText,
  startFakeOpenAi,
} from "./support/voice-fakes";

/**
 * The avatar asks on a call's own socket, over the real store on PGlite, a
 * fake OpenAI at the far end of the sideband, and LiveAvatar played by the
 * client's test double: the service answers the device's ask itself and
 * forwards nothing of it to OpenAI, the call's hang-up takes the face down
 * and closes its row, a deployment with no LiveAvatar key answers the ask
 * unavailable and the call goes on, and an ask that is not the frame its
 * type names is refused with the close. Every row is an account's this test
 * created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const API_KEY = "sk-test-project-key";
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const CLOSE_TIMEOUT_MS = 300;

const PLAN: Plan = {
  id: "5c1e8f4a-2b3d-4e6f-8a9b-0c1d2e3f4a5b",
  name: "Teammate invitations",
  createdAt: 1_000,
  updatedAt: 1_000,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

function record(text: string): WireRecord {
  const value = unparsedWire(JSON.parse(text));
  assert.ok(isRecord(value));
  return value;
}

/** One service over the suite's store, an account of its own holding the plan, and the LiveAvatar given. */
async function stand(avatar: Layer.Layer<LiveAvatar> | undefined) {
  const userId = await database.createUser();
  const plan = await database.run(createPlan(userId, PLAN));
  const openAi = await startFakeOpenAi();
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
          log: () => undefined,
          closeTimeoutMs: CLOSE_TIMEOUT_MS,
          firstFrameTimeoutMs: 1_000,
          attachTimeoutMs: 2_000,
          avatar,
        });
        return listener;
      }),
      scope,
    ),
  );
  /** Closes the service's scope, which waits for every fiber of its set, the avatar's stops among them. */
  const close = () => database.run(Scope.close(scope, Exit.void));
  onTestFinished(async () => {
    await close();
    await openAi.close();
  });

  /** A signed-in desktop through to a standing call about the plan, and OpenAI's end of its sideband. */
  const openSession = async () => {
    const opened = await connect(`ws://127.0.0.1:${port}${VOICE_SERVICE_PATH.SESSIONS}`, {
      authorization: FAKE_BEARER,
    });
    assert.ok("reader" in opened);
    const desktop = opened.reader;
    await send(desktop.socket, {
      type: VOICE_SERVICE_FRAME.SESSION_CREATE,
      sdp: SDP_OFFER,
      voice: LIVE_VOICE.MARIN,
      input: [],
      planId: plan.id,
    });
    const attach = await openAi.nextAttach();
    const created = sessionCreatedFrameFromWire(record(await desktop.next()));
    assert.ok(created?.voiceSessionId);
    return {
      desktop,
      attach,
      upstream: readSocket(attach.socket),
      voiceSessionId: created.voiceSessionId,
    };
  };

  return { userId, close, openSession };
}

test("a call's ask for the face is answered by the service, never reaches OpenAI, and its hang-up takes the face down", async () => {
  const liveAvatar = fakeLiveAvatar();
  const context = await stand(liveAvatar.layer);
  const { desktop, attach, upstream, voiceSessionId } = await context.openSession();

  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.AVATAR_START });
  const started = avatarStartedFrameFromWire(record(await desktop.next()));
  const [grant] = liveAvatar.granted;
  assert.ok(started && grant);
  assert.equal(started.avatarSessionId, grant.sessionId);
  assert.equal(started.viewerToken, grant.viewerToken);
  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(
    (await database.run(openAvatarSessionsOf({ userId: context.userId, voiceSessionId }))).map(
      (face) => face.liveAvatarSessionId,
    ),
    [grant.sessionId],
  );

  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    attach.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason: "close_requested",
      usage: { seconds: 4 },
    }),
  );
  await context.close();

  assert.deepEqual(liveAvatar.stopped, [
    { sessionId: grant.sessionId, reason: LIVEAVATAR_STOP_REASON.USER_CLOSED },
  ]);
  assert.deepEqual(
    await database.run(openAvatarSessionsOf({ userId: context.userId, voiceSessionId })),
    [],
  );
});

test("a deployment with no LiveAvatar key answers the ask unavailable, and the call goes on", async () => {
  const context = await stand(undefined);
  const { desktop, upstream } = await context.openSession();

  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.AVATAR_START });

  assert.deepEqual(avatarUnavailableFrameFromWire(record(await desktop.next())), {
    type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
    reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
  });
  assert.equal(await upstream.arrives(), false);
  assert.equal(desktop.socket.readyState, desktop.socket.OPEN);
});

test("an avatar ask that is not the frame its type names is refused with the close", async () => {
  const context = await stand(fakeLiveAvatar().layer);
  const { desktop, upstream } = await context.openSession();

  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.AVATAR_STOP, reason: "bored" });

  assert.equal((await desktop.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
});
