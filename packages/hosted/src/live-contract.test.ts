import assert from "node:assert/strict";
import {
  LIVE_AUDIO_ENCODING,
  LIVE_AUDIO_FORMAT,
  LIVE_VOICE,
  OBSERVED_VALUE_LENGTH,
  PROACTIVE_SPEECH_KIND,
} from "@sidecar/live";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  HOSTED_SERVICE_ORIGIN,
  HOSTED_VOICE_SERVICE_ORIGIN,
  hostedVoiceServiceOrigin,
  isHostedVoiceServiceAddress,
  sessionActivityFrameFromWire,
  sessionAttachedFrameFromWire,
  sessionAudioCreatedFrameFromWire,
  sessionAudioCreateFrameFromWire,
  sessionCreatedFrameFromWire,
  sessionOpeningFrameFromWire,
  sessionReportFrameFromWire,
  sessionSpokenFrameFromWire,
  VOICE_SERVICE_FRAME,
  webSocketOrigin,
} from "./live-contract.js";
import { VOICE_SERVICE_PATH } from "./service-paths.js";

const SDP =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

const developer = {
  type: "message",
  role: "developer",
  content: [{ type: "input_text", text: "Roster: one session working." }],
};
const part = { type: "input_text", text: "What needs me?" };
const user = { type: "message", role: "user", content: [part] };
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

test("an audio session.create frame is the voice and one of the four formats, with no offer and no seed", () => {
  const audio = {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    voice: LIVE_VOICE.MARIN,
    format: LIVE_AUDIO_FORMAT.PCM16_16K,
  };
  assert.deepEqual(sessionAudioCreateFrameFromWire(audio), audio);
  for (const format of Object.values(LIVE_AUDIO_FORMAT)) {
    assert.deepEqual(sessionAudioCreateFrameFromWire({ ...audio, format })?.format, format);
  }
  assert.equal(sessionAudioCreateFrameFromWire({ ...audio, sdp: SDP }), undefined);
  assert.equal(sessionAudioCreateFrameFromWire({ ...audio, input: [] }), undefined);
  assert.equal(
    sessionAudioCreateFrameFromWire({
      type: VOICE_SERVICE_FRAME.SESSION_CREATE,
      voice: LIVE_VOICE.MARIN,
    }),
    undefined,
  );
  assert.equal(
    sessionAudioCreateFrameFromWire({
      ...audio,
      format: { type: LIVE_AUDIO_ENCODING.PCM16, rate: 8_000 },
    }),
    undefined,
  );
  assert.equal(sessionAudioCreateFrameFromWire({ ...audio, voice: "hal" }), undefined);
  assert.equal(sessionAudioCreateFrameFromWire({ ...audio, model: "gpt-live-1" }), undefined);
  // The two create frames share a type and admit each other's shape on neither side.
  assert.equal(sessionAudioCreateFrameFromWire(createFrame()), undefined);
  assert.equal(sessionOpeningFrameFromWire(audio), undefined);
});

test("an audio session.created frame is the id and the quota, with no SDP answer, ignoring what a newer service adds", () => {
  const created = { type: VOICE_SERVICE_FRAME.SESSION_CREATED, sessionId: "live_123" };
  assert.deepEqual(sessionAudioCreatedFrameFromWire({ ...created, later: true }), created);
  const quota = { used: 2, limit: 30, resetsAt: 1_800_000_000_000 };
  assert.deepEqual(sessionAudioCreatedFrameFromWire({ ...created, quota }), { ...created, quota });
  const misquoted = sessionAudioCreatedFrameFromWire({ ...created, quota: { used: -1 } });
  assert.ok(misquoted);
  assert.equal("quota" in misquoted, false);
  assert.equal(
    sessionAudioCreatedFrameFromWire({ type: VOICE_SERVICE_FRAME.SESSION_CREATED }),
    undefined,
  );
  assert.equal(sessionAudioCreatedFrameFromWire({ ...created, sessionId: "  " }), undefined);
  // The WebRTC reader still wants its answer, so a Mac cannot mistake the audio route's for its own.
  assert.equal(sessionCreatedFrameFromWire(created), undefined);
});

test("an opening frame is either a create or an attach, told apart by type", () => {
  const attach = { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId: "live_123" };
  assert.equal(
    sessionOpeningFrameFromWire(createFrame())?.type,
    VOICE_SERVICE_FRAME.SESSION_CREATE,
  );
  assert.equal(sessionOpeningFrameFromWire(attach)?.type, VOICE_SERVICE_FRAME.SESSION_ATTACH);
  assert.equal(
    sessionOpeningFrameFromWire({ type: VOICE_SERVICE_FRAME.SESSION_CREATED, sessionId: "x" }),
    undefined,
  );
});

test("a session.attached frame answers the id it stands on, ignoring what a newer service adds", () => {
  const attached = { type: VOICE_SERVICE_FRAME.SESSION_ATTACHED, sessionId: "live_123" };
  assert.deepEqual(sessionAttachedFrameFromWire({ ...attached, later: true }), attached);
  assert.equal(
    sessionAttachedFrameFromWire({ type: VOICE_SERVICE_FRAME.SESSION_ATTACHED }),
    undefined,
  );
});

test("a session.activity frame is the type and one boolean, and nothing else", () => {
  const idle = { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: true };
  assert.deepEqual(sessionActivityFrameFromWire(idle), idle);
  assert.deepEqual(sessionActivityFrameFromWire({ ...idle, idle: false }), {
    ...idle,
    idle: false,
  });
  assert.equal(sessionActivityFrameFromWire({ ...idle, idle: "yes" }), undefined);
  assert.equal(sessionActivityFrameFromWire({ ...idle, later: true }), undefined);
  assert.equal(
    sessionActivityFrameFromWire({ type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY }),
    undefined,
  );
  assert.equal(sessionOpeningFrameFromWire(idle), undefined);
});

test("a session.stop frame is the type alone, and a report frame is either it or the activity", () => {
  const stop = { type: VOICE_SERVICE_FRAME.SESSION_STOP };
  const idle = { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: true };
  assert.deepEqual(sessionReportFrameFromWire(stop), stop);
  assert.equal(sessionReportFrameFromWire({ ...stop, content: "Stop." }), undefined);
  assert.deepEqual(sessionReportFrameFromWire(idle), idle);
  assert.equal(sessionReportFrameFromWire({ type: "session.instructions.append" }), undefined);
  assert.equal(sessionOpeningFrameFromWire(stop), undefined);
});

test("a session.beat frame names its kind and only the bounded values that kind's script may mention", () => {
  const arrival = {
    type: VOICE_SERVICE_FRAME.SESSION_BEAT,
    kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
    sessionTitle: "  Fix the flaky test  ",
    talkKeyLabel: "Right Option",
  };
  assert.deepEqual(sessionReportFrameFromWire(arrival), {
    ...arrival,
    sessionTitle: "Fix the flaky test",
  });
  const bare = { type: VOICE_SERVICE_FRAME.SESSION_BEAT, kind: PROACTIVE_SPEECH_KIND.ARRIVAL };
  assert.deepEqual(sessionReportFrameFromWire(bare), bare);
  const calendar = {
    type: VOICE_SERVICE_FRAME.SESSION_BEAT,
    kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
  };
  assert.deepEqual(sessionReportFrameFromWire(calendar), calendar);
  const launch = {
    type: VOICE_SERVICE_FRAME.SESSION_BEAT,
    kind: PROACTIVE_SPEECH_KIND.LAUNCH,
    firstName: "Ada",
  };
  assert.deepEqual(sessionReportFrameFromWire(launch), launch);
  // A value the kind's script does not mention, a briefing (the brain's words are never the
  // desktop's to send), a value past the bound, a blank one, and a sentence of the desktop's own.
  assert.equal(sessionReportFrameFromWire({ ...calendar, sessionTitle: "x" }), undefined);
  assert.equal(sessionReportFrameFromWire({ ...launch, sessionTitle: "x" }), undefined);
  assert.equal(sessionReportFrameFromWire({ ...bare, firstName: "Ada" }), undefined);
  assert.equal(
    sessionReportFrameFromWire({ ...bare, kind: PROACTIVE_SPEECH_KIND.BRIEFING, briefing: "Hi" }),
    undefined,
  );
  assert.equal(
    sessionReportFrameFromWire({ ...launch, firstName: "a".repeat(OBSERVED_VALUE_LENGTH + 1) }),
    undefined,
  );
  assert.equal(sessionReportFrameFromWire({ ...launch, firstName: "   " }), undefined);
  assert.equal(sessionReportFrameFromWire({ ...bare, content: "Say hello." }), undefined);
  assert.equal(sessionOpeningFrameFromWire(launch), undefined);
});

test("a session.spoken frame is the kind alone, any kind spoken, and ignores a key a newer service adds", () => {
  for (const kind of Object.values(PROACTIVE_SPEECH_KIND)) {
    const spoken = { type: VOICE_SERVICE_FRAME.SESSION_SPOKEN, kind };
    assert.deepEqual(sessionSpokenFrameFromWire(spoken), spoken);
    assert.deepEqual(sessionSpokenFrameFromWire({ ...spoken, later: 1 }), spoken);
  }
  assert.equal(
    sessionSpokenFrameFromWire({ type: VOICE_SERVICE_FRAME.SESSION_SPOKEN, kind: "greeting" }),
    undefined,
  );
  assert.equal(sessionSpokenFrameFromWire({ type: VOICE_SERVICE_FRAME.SESSION_SPOKEN }), undefined);
  // It is the service's to send, never the desktop's: the report union refuses it.
  assert.equal(
    sessionReportFrameFromWire({
      type: VOICE_SERVICE_FRAME.SESSION_SPOKEN,
      kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
    }),
    undefined,
  );
});

test("the frame types are eight distinct members", () => {
  assert.equal(new Set(Object.values(VOICE_SERVICE_FRAME)).size, 8);
});

test("the voice service origin is the service's own origin in socket form", () => {
  assert.equal(HOSTED_VOICE_SERVICE_ORIGIN, webSocketOrigin(HOSTED_SERVICE_ORIGIN));
  assert.equal(new URL(HOSTED_VOICE_SERVICE_ORIGIN).protocol, "wss:");
  assert.equal(new URL(HOSTED_VOICE_SERVICE_ORIGIN).host, new URL(HOSTED_SERVICE_ORIGIN).host);
  assert.equal(new URL(HOSTED_VOICE_SERVICE_ORIGIN).origin, HOSTED_VOICE_SERVICE_ORIGIN);
});

test("a socket origin is derived from an http or socket address, and from nothing else", () => {
  assert.equal(webSocketOrigin("https://luke.test/api/auth"), "wss://luke.test");
  assert.equal(webSocketOrigin("http://localhost:3000/"), "ws://localhost:3000");
  assert.equal(webSocketOrigin("ws://localhost:8788/sessions"), "ws://localhost:8788");
  assert.equal(webSocketOrigin("wss://luke.test:8443"), "wss://luke.test:8443");
  assert.equal(webSocketOrigin("data:text/plain,x"), undefined);
  assert.equal(webSocketOrigin("localhost:8788"), undefined);
  assert.equal(webSocketOrigin("not a url"), undefined);
});

test("an address is the voice service's by origin alone", () => {
  assert.equal(
    isHostedVoiceServiceAddress(`${HOSTED_VOICE_SERVICE_ORIGIN}${VOICE_SERVICE_PATH.SESSIONS}`),
    true,
  );
  assert.equal(isHostedVoiceServiceAddress(`${HOSTED_VOICE_SERVICE_ORIGIN}/other?x=1#y`), true);
  const { host } = new URL(HOSTED_VOICE_SERVICE_ORIGIN);
  assert.equal(isHostedVoiceServiceAddress(`wss://${host}.evil.example/sessions`), false);
  assert.equal(isHostedVoiceServiceAddress(`ws://${host}/sessions`), false);
  assert.equal(isHostedVoiceServiceAddress(`wss://${host}:8443/sessions`), false);
  assert.equal(isHostedVoiceServiceAddress("not a url"), false);
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
