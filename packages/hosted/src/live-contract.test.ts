import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_INPUT_BOUNDS, LIVE_VOICE } from "@sidecar/live";
import { SCHEMA_REFUSAL, type UnparsedWireValue, type WireValue } from "@sidecar/wire";
import {
  HOSTED_VOICE_SERVICE_ORIGIN,
  hostedVoiceServiceOrigin,
  isHostedVoiceServiceAddress,
  liveSessionCreatedSchema,
  SESSION_CREATE_BOUNDS,
  sessionCreatedFrameSchema,
  sessionCreateFrameSchema,
  VOICE_SERVICE_FRAME,
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

test("a session.create frame round-trips with its offer and seed as written", () => {
  const frame = createFrame();
  assert.deepEqual(sessionCreateFrameSchema.parse(frame), frame);
});

test("a session.create frame may open with no history at all", () => {
  const parsed = sessionCreateFrameSchema.parse(createFrame({ input: [] }));
  assert.deepEqual(parsed?.input, []);
});

test("a voice outside the Live built-in set is refused at the voice field", () => {
  const read = sessionCreateFrameSchema.read(createFrame({ voice: "hal" }));
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.equal(read.refusal, SCHEMA_REFUSAL.MALFORMED);
    assert.deepEqual(read.path, ["voice"]);
  }
});

test("a seed past the Live input bound is too large, one item under it is not", () => {
  const atBound = Array.from({ length: LIVE_INPUT_BOUNDS.MESSAGES }, () => user);
  assert.equal(sessionCreateFrameSchema.read(createFrame({ input: atBound })).ok, true);
  const over = sessionCreateFrameSchema.read(createFrame({ input: [...atBound, user] }));
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.equal(over.refusal, SCHEMA_REFUSAL.TOO_LARGE);
    assert.deepEqual(over.path, ["input"]);
  }
});

test("an item's text past its character bound refuses the frame at that item", () => {
  const long = {
    ...user,
    content: [{ type: "input_text", text: "x".repeat(SESSION_CREATE_BOUNDS.ITEM_CHARS + 1) }],
  };
  const read = sessionCreateFrameSchema.read(createFrame({ input: [developer, long] }));
  assert.equal(read.ok, false);
  if (!read.ok) assert.deepEqual(read.path, ["input", 1]);
  const atBound = {
    ...long,
    content: [{ type: "input_text", text: "x".repeat(SESSION_CREATE_BOUNDS.ITEM_CHARS) }],
  };
  assert.equal(sessionCreateFrameSchema.read(createFrame({ input: [atBound] })).ok, true);
});

test("a seed item is a message of one text part of the type its role writes, and nothing else", () => {
  const cases: [WireValue, boolean][] = [
    [{ ...user, role: "system" }, false],
    [{ ...user, content: [{ type: "output_text", text: "wrong part" }] }, false],
    [{ ...assistant, content: [{ type: "input_text", text: "wrong part" }] }, false],
    [{ ...assistant, content: [{ type: "text", text: "plain" }] }, false],
    [{ ...user, content: [] }, false],
    [{ ...user, content: [part, part] }, false],
    [{ ...user, id: "msg_1" }, false],
    [{ ...user, status: "completed" }, false],
    [{ role: "user", content: [part] }, false],
    [user, true],
    [assistant, true],
  ];
  for (const [item, admitted] of cases) {
    assert.equal(sessionCreateFrameSchema.read(createFrame({ input: [item] })).ok, admitted);
  }
});

test("a frame of the other type, or with a field beside the four, is not a session.create", () => {
  assert.equal(
    sessionCreateFrameSchema.read(createFrame({ type: VOICE_SERVICE_FRAME.SESSION_CREATED })).ok,
    false,
  );
  assert.equal(sessionCreateFrameSchema.read(createFrame({ model: "gpt-live-1" })).ok, false);
  assert.equal(sessionCreateFrameSchema.read(createFrame({ sdp: "   " })).ok, false);
});

test("a session.created frame round-trips, with or without a quota, ignoring what a newer service adds", () => {
  const created = {
    type: VOICE_SERVICE_FRAME.SESSION_CREATED,
    sessionId: "live_123",
    sdpAnswer: SDP,
  };
  assert.deepEqual(sessionCreatedFrameSchema.parse({ ...created, later: true }), created);
  const quota = { used: 2, limit: 30, resetsAt: 1_800_000_000_000 };
  assert.deepEqual(sessionCreatedFrameSchema.parse({ ...created, quota })?.quota, quota);
  const misquoted = sessionCreatedFrameSchema.parse({ ...created, quota: { used: -1 } });
  assert.ok(misquoted);
  assert.equal("quota" in misquoted, false);
});

test("the created session read on its own is the id and the answer, both required", () => {
  assert.deepEqual(
    liveSessionCreatedSchema.parse({ sessionId: "live_123", sdpAnswer: SDP, quota: {} }),
    {
      sessionId: "live_123",
      sdpAnswer: SDP,
    },
  );
  assert.equal(liveSessionCreatedSchema.parse({ sessionId: "live_123" }), undefined);
  assert.equal(liveSessionCreatedSchema.parse({ sdpAnswer: SDP }), undefined);
});

test("the frame types are two distinct members", () => {
  assert.equal(new Set(Object.values(VOICE_SERVICE_FRAME)).size, 2);
});

test("an address is the voice service's by origin alone", () => {
  assert.equal(
    isHostedVoiceServiceAddress(`${HOSTED_VOICE_SERVICE_ORIGIN}${VOICE_SERVICE_PATH.SESSIONS}`),
    true,
  );
  assert.equal(isHostedVoiceServiceAddress(`${HOSTED_VOICE_SERVICE_ORIGIN}/other?x=1#y`), true);
  assert.equal(isHostedVoiceServiceAddress("wss://voice.tryluke.dev.evil.example/sessions"), false);
  assert.equal(isHostedVoiceServiceAddress("ws://voice.tryluke.dev/sessions"), false);
  assert.equal(isHostedVoiceServiceAddress("wss://voice.tryluke.dev:8443/sessions"), false);
  assert.equal(isHostedVoiceServiceAddress("not a url"), false);
  assert.equal(new URL(HOSTED_VOICE_SERVICE_ORIGIN).origin, HOSTED_VOICE_SERVICE_ORIGIN);
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
