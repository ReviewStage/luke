import assert from "node:assert/strict";
import { LIVE_VOICE } from "@sidecar/live";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  AVATAR_END_REASON,
  AVATAR_FRAME_BOUNDS,
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  avatarEndedFrameFromWire,
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

function startedFrame(overrides: { [field: string]: UnparsedWireValue } = {}) {
  return {
    type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
    avatarSessionId: "a1b2c3",
    livekitUrl: "wss://avatar.livekit.cloud",
    viewerToken: "eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6e319.c2ln",
    mediaUrl: "wss://media.liveavatar.com/v1/sessions/a1b2c3",
    maxSeconds: 1_200,
    ...overrides,
  };
}

test("the desktop's avatar asks are read as declared, refusing a stray key or an unlisted reason", () => {
  const start = { type: VOICE_SERVICE_FRAME.AVATAR_START };
  const stop = { type: VOICE_SERVICE_FRAME.AVATAR_STOP, reason: AVATAR_STOP_REASON.MEDIA_LOST };
  assert.deepEqual(avatarRequestFrameFromWire(start), start);
  assert.deepEqual(avatarRequestFrameFromWire(stop), stop);
  assert.equal(avatarRequestFrameFromWire({ ...start, avatarId: "someone-else" }), undefined);
  assert.equal(avatarRequestFrameFromWire({ ...stop, reason: "bored" }), undefined);
  assert.equal(avatarRequestFrameFromWire({ type: VOICE_SERVICE_FRAME.AVATAR_STOP }), undefined);
  assert.equal(avatarRequestFrameFromWire(startedFrame()), undefined);
});

test("avatar.started admits a room on wss and refuses a malformed or oversized one", () => {
  assert.deepEqual(avatarStartedFrameFromWire({ ...startedFrame(), later: true }), startedFrame());
  const refused: { [field: string]: UnparsedWireValue }[] = [
    { livekitUrl: "ws://avatar.livekit.cloud" },
    { mediaUrl: "https://media.liveavatar.com" },
    { mediaUrl: "not a url" },
    { livekitUrl: `wss://avatar.livekit.cloud/${"a".repeat(AVATAR_FRAME_BOUNDS.URL_CHARS)}` },
    { viewerToken: " " },
    { viewerToken: "a".repeat(AVATAR_FRAME_BOUNDS.TOKEN_CHARS + 1) },
    { avatarSessionId: "" },
    { avatarSessionId: "a".repeat(AVATAR_FRAME_BOUNDS.SESSION_ID_CHARS + 1) },
    { maxSeconds: 0 },
    { maxSeconds: 1.5 },
    { maxSeconds: AVATAR_FRAME_BOUNDS.MAX_SECONDS + 1 },
    { maxSeconds: "1200" },
  ];
  for (const overrides of refused) {
    assert.equal(
      avatarStartedFrameFromWire(startedFrame(overrides)),
      undefined,
      JSON.stringify(overrides),
    );
  }
  const { viewerToken: _token, ...tokenless } = startedFrame();
  assert.equal(avatarStartedFrameFromWire(tokenless), undefined);
});

test("an avatar's end or refusal reads a reason a newer service added as an error, and refuses a malformed one", () => {
  const ended = { type: VOICE_SERVICE_FRAME.AVATAR_ENDED, reason: AVATAR_END_REASON.MAX_DURATION };
  assert.deepEqual(avatarEndedFrameFromWire(ended), ended);
  assert.equal(
    avatarEndedFrameFromWire({ ...ended, reason: "solar_flare" })?.reason,
    AVATAR_END_REASON.ERROR,
  );
  assert.equal(avatarEndedFrameFromWire({ ...ended, reason: 7 }), undefined);
  assert.equal(
    avatarEndedFrameFromWire({
      ...ended,
      reason: "a".repeat(AVATAR_FRAME_BOUNDS.REASON_CHARS + 1),
    }),
    undefined,
  );
  const unavailable = {
    type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
    reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
  };
  assert.deepEqual(avatarUnavailableFrameFromWire(unavailable), unavailable);
  assert.equal(
    avatarUnavailableFrameFromWire({ ...unavailable, reason: "maintenance" })?.reason,
    AVATAR_UNAVAILABLE_REASON.ERROR,
  );
  assert.equal(avatarUnavailableFrameFromWire({ type: unavailable.type }), undefined);
  assert.equal(avatarUnavailableFrameFromWire(ended), undefined);
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
