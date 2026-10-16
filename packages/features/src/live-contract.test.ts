import assert from "node:assert/strict";
import { LIVE_VOICE } from "@luke/live";
import type { UnparsedWireValue } from "@luke/wire";
import { test } from "vitest";
import {
  AVATAR_FRAME_BOUNDS,
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  avatarRequestFrameFromWire,
  avatarStartedFrameFromWire,
  avatarUnavailableFrameFromWire,
  HOSTED_VOICE_SERVICE_ORIGIN,
  hostedVoiceServiceOrigin,
  isHostedVoiceServiceAddress,
  sessionCreatedFrameFromWire,
  sessionOpeningFrameFromWire,
  VOICE_SERVICE_FRAME,
} from "./live-contract.js";

const SDP =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

const developer = {
  type: "message",
  role: "developer",
  content: [{ type: "input_text", text: "Roster: one session working." }],
};
const part = { type: "input_text", text: "What needs me?" };
const user = { type: "message", role: "user", content: [part] };
const PLAN_ID = "1a000000-0000-4000-8000-000000000001";

const assistant = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Nothing yet." }],
};

function createFrame(overrides: { [field: string]: UnparsedWireValue } = {}) {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP,
    voice: LIVE_VOICE.MARIN,
    input: [developer, user, assistant],
    planId: PLAN_ID,
    ...overrides,
  };
}

test("a session.created frame round-trips, with or without a quota, ignoring what a newer service adds", () => {
  const created = {
    type: VOICE_SERVICE_FRAME.SESSION_CREATED,
    sessionId: "live_123",
    sdpAnswer: SDP,
  };
  assert.deepEqual(sessionCreatedFrameFromWire({ ...created, later: true }), created);
  const quota = { used: 2, limit: 30, resetsAt: 1_800_000_000_000 };
  assert.deepEqual(sessionCreatedFrameFromWire({ ...created, quota })?.quota, quota);
  const misquoted = sessionCreatedFrameFromWire({ ...created, quota: { used: -1 } });
  assert.ok(misquoted);
  assert.equal("quota" in misquoted, false);
});

test("an opening frame is either a create or an attach, told apart by type", () => {
  const attach = { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId: "live_123" };
  assert.equal(
    sessionOpeningFrameFromWire(createFrame())?.type,
    VOICE_SERVICE_FRAME.SESSION_CREATE,
  );
  assert.equal(sessionOpeningFrameFromWire(attach)?.type, VOICE_SERVICE_FRAME.SESSION_ATTACH);
  // Every call is about one plan: a create that names none, or names it in another shape, is refused.
  const { planId: _named, ...planless } = createFrame();
  assert.equal(sessionOpeningFrameFromWire(planless), undefined);
  assert.equal(sessionOpeningFrameFromWire(createFrame({ planId: "plan-1" })), undefined);
  assert.equal(
    sessionOpeningFrameFromWire({ type: VOICE_SERVICE_FRAME.SESSION_CREATED, sessionId: "x" }),
    undefined,
  );
});

test("a development override reduces to its origin; a packaged build never leaves the pinned one", () => {
  assert.equal(
    hostedVoiceServiceOrigin({ packaged: false, override: undefined }),
    HOSTED_VOICE_SERVICE_ORIGIN,
  );
  assert.equal(
    hostedVoiceServiceOrigin({ packaged: false, override: "ws://localhost:8788/sessions" }),
    "ws://localhost:8788",
  );
  assert.equal(
    hostedVoiceServiceOrigin({ packaged: false, override: "http://localhost:3000/api/auth" }),
    "ws://localhost:3000",
  );
  assert.equal(
    hostedVoiceServiceOrigin({ packaged: true, override: "ws://localhost:8788" }),
    HOSTED_VOICE_SERVICE_ORIGIN,
  );
  assert.equal(
    hostedVoiceServiceOrigin({ packaged: false, override: "localhost:8788" }),
    HOSTED_VOICE_SERVICE_ORIGIN,
  );
  assert.equal(
    hostedVoiceServiceOrigin({ packaged: false, override: "data:text/plain,x" }),
    HOSTED_VOICE_SERVICE_ORIGIN,
  );
  const local = hostedVoiceServiceOrigin({ packaged: false, override: "ws://localhost:8788" });
  assert.equal(isHostedVoiceServiceAddress("ws://localhost:8788/sessions", local), true);
});

const REQUEST_ID = "2b000000-0000-4000-8000-000000000002";

test("the desktop's avatar frames are a start with nothing else, or a stop with a listed reason", () => {
  const start = { type: VOICE_SERVICE_FRAME.AVATAR_START, requestId: REQUEST_ID };
  const stop = {
    type: VOICE_SERVICE_FRAME.AVATAR_STOP,
    requestId: REQUEST_ID,
    reason: AVATAR_STOP_REASON.SERVER_CLOSED,
  };
  assert.deepEqual(avatarRequestFrameFromWire(start), start);
  assert.deepEqual(avatarRequestFrameFromWire(stop), stop);
  // A request names only what it declares: the service picks the persona, never the desktop.
  assert.equal(avatarRequestFrameFromWire({ ...start, personaId: "p_1" }), undefined);
  assert.equal(avatarRequestFrameFromWire({ ...stop, reason: "bored" }), undefined);
  assert.equal(
    avatarRequestFrameFromWire({ type: VOICE_SERVICE_FRAME.AVATAR_STOP, requestId: REQUEST_ID }),
    undefined,
  );
  const longId = "r".repeat(AVATAR_FRAME_BOUNDS.REQUEST_ID_CHARS + 1);
  assert.equal(avatarRequestFrameFromWire({ ...start, requestId: longId }), undefined);
  assert.equal(
    avatarRequestFrameFromWire({ type: VOICE_SERVICE_FRAME.AVATAR_STARTED, reason: "user" }),
    undefined,
  );
});

test("an avatar.started frame admits a bounded grant on a secure socket, and nothing malformed", () => {
  const started = {
    type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
    requestId: REQUEST_ID,
    serverUrl: "wss://keyframe-abc.livekit.cloud",
    participantToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl",
    agentIdentity: "keyframe-agent-1",
  };
  assert.deepEqual(avatarStartedFrameFromWire({ ...started, later: true }), started);
  for (const serverUrl of ["ws://keyframe.livekit.cloud", "https://keyframe.livekit.cloud", "x"]) {
    assert.equal(avatarStartedFrameFromWire({ ...started, serverUrl }), undefined, serverUrl);
  }
  const longUrl = `wss://keyframe.livekit.cloud/${"a".repeat(AVATAR_FRAME_BOUNDS.URL_CHARS)}`;
  assert.equal(avatarStartedFrameFromWire({ ...started, serverUrl: longUrl }), undefined);
  const longToken = "t".repeat(AVATAR_FRAME_BOUNDS.TOKEN_CHARS + 1);
  assert.equal(avatarStartedFrameFromWire({ ...started, participantToken: longToken }), undefined);
  assert.equal(avatarStartedFrameFromWire({ ...started, participantToken: "  " }), undefined);
  const longIdentity = "i".repeat(AVATAR_FRAME_BOUNDS.IDENTITY_CHARS + 1);
  assert.equal(avatarStartedFrameFromWire({ ...started, agentIdentity: longIdentity }), undefined);
  const { agentIdentity: _identity, ...anonymous } = started;
  assert.equal(avatarStartedFrameFromWire(anonymous), undefined);
});

test("an avatar.unavailable reason a newer service added reads as an error, and an oversized one is refused", () => {
  const unavailable = {
    type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
    requestId: REQUEST_ID,
    reason: AVATAR_UNAVAILABLE_REASON.NO_CAPACITY,
  };
  assert.deepEqual(avatarUnavailableFrameFromWire(unavailable), unavailable);
  assert.equal(
    avatarUnavailableFrameFromWire({ ...unavailable, reason: "region_closed" })?.reason,
    AVATAR_UNAVAILABLE_REASON.ERROR,
  );
  const long = "r".repeat(AVATAR_FRAME_BOUNDS.REASON_CHARS + 1);
  assert.equal(avatarUnavailableFrameFromWire({ ...unavailable, reason: long }), undefined);
  assert.equal(avatarUnavailableFrameFromWire({ ...unavailable, reason: 503 }), undefined);
});

test("every avatar frame without its request id is refused, the answers included", () => {
  const frames = [
    { type: VOICE_SERVICE_FRAME.AVATAR_START },
    { type: VOICE_SERVICE_FRAME.AVATAR_STOP, reason: AVATAR_STOP_REASON.USER },
  ];
  for (const frame of frames) assert.equal(avatarRequestFrameFromWire(frame), undefined);
  assert.equal(
    avatarStartedFrameFromWire({
      type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
      serverUrl: "wss://keyframe-abc.livekit.cloud",
      participantToken: "token",
      agentIdentity: "keyframe-agent-1",
    }),
    undefined,
  );
  // The unavailable reason is read leniently; the request id never is.
  assert.equal(
    avatarUnavailableFrameFromWire({
      type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
      reason: AVATAR_UNAVAILABLE_REASON.ERROR,
    }),
    undefined,
  );
});
