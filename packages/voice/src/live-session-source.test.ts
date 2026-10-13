import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  AVATAR_END_REASON,
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  type AvatarEndedFrame,
  type AvatarStartedFrame,
  type AvatarUnavailableFrame,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import { LIVE_SERVER_EVENT, LIVE_SESSION_OUTCOME, LIVE_VOICE } from "@sidecar/live";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { Effect, Stream } from "effect";
import { type HostedLiveSessionOptions, HostedLiveSessionSource } from "./live-session-source.js";
import { SOCKET_OPEN_FAULT } from "./live-socket.js";
import { type ScriptedOpening, type ScriptedSocketSeam, scriptedOpenSocket } from "./testing.js";

const NOW = 1_800_000_000_000;
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SDP_ANSWER =
  "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SESSION_ID = "ls_123";
const SERVICE_ORIGIN = "wss://voice.example.test";
const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const QUOTA = { used: 3, limit: 50, resetsAt: NOW + 3_600_000 };
const AVATAR_STARTED = {
  type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
  avatarSessionId: "av_1",
  livekitUrl: "wss://room.example.test",
  viewerToken: "viewer-token-1",
  mediaUrl: "wss://media.example.test/v1/ws",
  maxSeconds: 1_200,
};

function createdFrame(overrides: ParsedJsonObject = {}) {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATED,
    sessionId: SESSION_ID,
    sdpAnswer: SDP_ANSWER,
    quota: QUOTA,
    ...overrides,
  };
}

function answering(frame: ParsedJsonObject): ScriptedOpening {
  return (socket) => {
    socket.onSent(() => queueMicrotask(() => socket.receive(frame)));
    return undefined;
  };
}

function hosted(script: ScriptedSocketSeam, options: Partial<HostedLiveSessionOptions> = {}) {
  return new HostedLiveSessionSource({
    serviceOrigin: SERVICE_ORIGIN,
    openSocket: script.openSocket,
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("dev@example.test"),
    requestTimeoutMs: 50,
    ...options,
  });
}

it.live(
  "the hosted source opens one socket with the bearer on its handshake and sends the create frame first, naming its plan and seeding nothing",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame())]);
      const source = hosted(script, { voice: LIVE_VOICE.MARIN });

      const opened = yield* source.create({ sdpOffer: SDP_OFFER, planId: PLAN_ID });

      assert.equal(opened?.sessionId, SESSION_ID);
      assert.equal(opened?.sdpAnswer, SDP_ANSWER);
      // A frame naming no store row for the session hands on no key for one.
      assert.equal(opened !== undefined && Object.hasOwn(opened, "voiceSessionId"), false);
      assert.equal(script.opens.length, 1);
      assert.equal(script.opens[0]?.url, `${SERVICE_ORIGIN}${VOICE_SERVICE_PATH.SESSIONS}`);
      assert.deepEqual(script.opens[0]?.headers, { authorization: "Bearer token-1" });
      const [socket] = script.sockets;
      assert.equal(socket?.sent.length, 1);
      assert.deepEqual(JSON.parse(socket?.sent[0] ?? ""), {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: [],
        planId: PLAN_ID,
      });
      const report = source.diagnostics();
      assert.equal(report.lastOutcome, LIVE_SESSION_OUTCOME.SUCCEEDED);
      assert.deepEqual(report.quota, QUOTA);
    }),
);

it.live("the hosted source refuses to open without an access token and opens no socket", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame())]);
    const source = hosted(script, { readAccessToken: () => Effect.succeed(undefined) });

    assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, planId: PLAN_ID }), undefined);
    assert.equal(script.opens.length, 0);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
  }),
);

it.live("the hosted source does not carry a renewed bearer for another account", () =>
  Effect.gen(function* () {
    let token = "token-old";
    let holder = "one@example.test";
    const script = scriptedOpenSocket([
      () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }),
      answering(createdFrame()),
    ]);
    const source = hosted(script, {
      readAccessToken: () => Effect.succeed(token),
      readAccountKey: () => Effect.succeed(holder),
      refreshAccount: () =>
        Effect.sync(() => {
          token = "token-new";
          holder = "two@example.test";
        }),
    });

    assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, planId: PLAN_ID }), undefined);
    assert.equal(script.opens.length, 1);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
  }),
);

it.effect(
  "the hosted source asks the service for the face and its end on the session's socket",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame())]);
      const opened = yield* hosted(script).create({ sdpOffer: SDP_OFFER, planId: PLAN_ID });

      opened?.startAvatar?.();
      opened?.stopAvatar?.(AVATAR_STOP_REASON.MEDIA_LOST);

      const sent = script.sockets[0]?.sent.slice(1).map((data) => JSON.parse(data));
      assert.deepEqual(sent, [
        { type: VOICE_SERVICE_FRAME.AVATAR_START },
        { type: VOICE_SERVICE_FRAME.AVATAR_STOP, reason: AVATAR_STOP_REASON.MEDIA_LOST },
      ]);
    }),
);

it.effect(
  "the hosted source tells the face's frames to their listeners and the sideband reads only the session's events",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame())]);
      const opened = yield* hosted(script).create({ sdpOffer: SDP_OFFER, planId: PLAN_ID });
      assert.ok(opened);
      const started: AvatarStartedFrame[] = [];
      const ended: AvatarEndedFrame[] = [];
      const unavailable: AvatarUnavailableFrame[] = [];
      opened.onAvatarStarted?.((frame) => started.push(frame));
      opened.onAvatarEnded?.((frame) => ended.push(frame));
      opened.onAvatarUnavailable?.((frame) => unavailable.push(frame));
      const sideband = yield* opened.attach();
      const socket = script.sockets[0];
      assert.ok(socket);

      socket.receive(AVATAR_STARTED);
      socket.receive({ type: VOICE_SERVICE_FRAME.AVATAR_ENDED, reason: "a_newer_reason" });
      socket.receive({
        type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
        reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
      });
      socket.receive({
        type: LIVE_SERVER_EVENT.SESSION_STARTED,
        event_id: "started",
        session: { id: SESSION_ID },
      });
      const [first] = yield* Stream.runCollect(Stream.take(sideband.arrivals, 1));

      assert.deepEqual(started, [AVATAR_STARTED]);
      // A reason a newer service added still says the face is down.
      assert.deepEqual(ended, [
        { type: VOICE_SERVICE_FRAME.AVATAR_ENDED, reason: AVATAR_END_REASON.ERROR },
      ]);
      assert.deepEqual(unavailable, [
        {
          type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
          reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
        },
      ]);
      assert.equal(
        first !== undefined && "event" in first && first.event.type,
        LIVE_SERVER_EVENT.SESSION_STARTED,
      );
    }),
);

it.effect("the hosted source tells its listener no face whose room is not on a secure socket", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame())]);
    const opened = yield* hosted(script).create({ sdpOffer: SDP_OFFER, planId: PLAN_ID });
    assert.ok(opened);
    const started: AvatarStartedFrame[] = [];
    opened.onAvatarStarted?.((frame) => started.push(frame));
    const sideband = yield* opened.attach();
    const socket = script.sockets[0];
    assert.ok(socket);

    socket.receive({ ...AVATAR_STARTED, livekitUrl: "ws://room.example.test" });
    socket.receive(AVATAR_STARTED);
    socket.receive({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: SESSION_ID },
    });
    yield* Stream.runCollect(Stream.take(sideband.arrivals, 1));

    assert.deepEqual(started, [AVATAR_STARTED]);
  }),
);
