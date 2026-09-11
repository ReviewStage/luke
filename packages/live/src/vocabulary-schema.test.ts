import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Either, Schema } from "effect";
import { test } from "vitest";
import {
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_SERVER_EVENT,
  LIVE_STATUS,
  LiveClientEventTypeSchema,
  LiveCloseReasonSchema,
  LiveDelegationTargetSchema,
  LiveServerEventTypeSchema,
  LiveStatusSchema,
} from "./events.js";
import {
  INSTRUCTION_SECTION,
  InstructionSectionSchema,
  LIVE_SCENE,
  LiveSceneSchema,
} from "./instructions.js";
import { PROACTIVE_SPEECH_KIND, ProactiveSpeechKindSchema } from "./proactive.js";
import {
  DisabledByFixtureRefusal,
  HostedUnavailableRefusal,
  HttpErrorRefusal,
  LIVE_DELEGATION_TYPE,
  LIVE_SESSION_OUTCOME,
  LIVE_SESSION_REFUSALS,
  LIVE_TRANSPORT_TYPE,
  LiveDelegationTypeSchema,
  LiveTransportTypeSchema,
  MalformedResponseRefusal,
  NetworkErrorRefusal,
  NoApiKeyRefusal,
  NotSignedInRefusal,
  QuotaExhaustedRefusal,
  SidebandFailedRefusal,
} from "./session.js";
import { LIVE_VOICE, LiveVoiceSchema } from "./voices.js";

const NOTHING_ANY_VOCABULARY_HOLDS: readonly UnparsedWireValue[] = [
  "",
  " ",
  "not-a-member",
  undefined,
  17,
  true,
  {},
  [],
];

function settlesVocabulary<Member extends string>(
  schema: Schema.Schema<Member>,
  members: readonly Member[],
  alsoRefused: readonly UnparsedWireValue[] = [],
): void {
  const decode = Schema.decodeUnknownEither(schema);
  for (const member of members) assert.deepEqual(decode(member), Either.right(member));
  for (const refused of [...NOTHING_ANY_VOCABULARY_HOLDS, ...alsoRefused]) {
    assert.equal(Either.isLeft(decode(refused)), true);
  }
}

test("the session's phase is one of the states the panel and the host both read", () => {
  settlesVocabulary(LiveStatusSchema, Object.values(LIVE_STATUS));
});

test("the transport vocabulary holds only the client and server event names this build sends and reads", () => {
  settlesVocabulary(LiveClientEventTypeSchema, Object.values(LIVE_CLIENT_EVENT));
  settlesVocabulary(LiveServerEventTypeSchema, Object.values(LIVE_SERVER_EVENT), [
    LIVE_CLIENT_EVENT.CLOSE,
  ]);
});

test("a session's close reason and a delegation's target hold their own sets alone", () => {
  settlesVocabulary(LiveCloseReasonSchema, Object.values(LIVE_CLOSE_REASON));
  settlesVocabulary(LiveDelegationTargetSchema, Object.values(LIVE_DELEGATION_TARGET));
});

test("the single-valued transport and delegation constants are schemas of exactly one member", () => {
  settlesVocabulary(LiveTransportTypeSchema, [LIVE_TRANSPORT_TYPE], ["http", "grpc"]);
  settlesVocabulary(LiveDelegationTypeSchema, [LIVE_DELEGATION_TYPE], ["server"]);
});

test("a scene and its instruction sections hold their own sets alone", () => {
  settlesVocabulary(LiveSceneSchema, Object.values(LIVE_SCENE));
  settlesVocabulary(InstructionSectionSchema, Object.values(INSTRUCTION_SECTION));
});

test("proactive speech is one of the kinds this build knows how to word", () => {
  settlesVocabulary(ProactiveSpeechKindSchema, Object.values(PROACTIVE_SPEECH_KIND));
});

test("a voice arriving from storage or IPC is a schema of the SDK's built-in set", () => {
  settlesVocabulary(LiveVoiceSchema, Object.values(LIVE_VOICE));
});

test("every non-success session outcome has its own tagged error carrying the legacy code", () => {
  assert.equal(LIVE_SESSION_REFUSALS.length, 9);
  assert.equal(new NoApiKeyRefusal({ code: LIVE_SESSION_OUTCOME.NO_API_KEY }).code, "no-api-key");
  assert.equal(
    new DisabledByFixtureRefusal({ code: LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE }).code,
    "disabled-by-fixture",
  );
  assert.equal(new HttpErrorRefusal({ code: LIVE_SESSION_OUTCOME.HTTP_ERROR }).code, "http-error");
  assert.equal(
    new NetworkErrorRefusal({ code: LIVE_SESSION_OUTCOME.NETWORK_ERROR }).code,
    "network-error",
  );
  assert.equal(
    new MalformedResponseRefusal({ code: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE }).code,
    "malformed-response",
  );
  assert.equal(
    new SidebandFailedRefusal({ code: LIVE_SESSION_OUTCOME.SIDEBAND_FAILED }).code,
    "sideband-failed",
  );
  assert.equal(
    new NotSignedInRefusal({ code: LIVE_SESSION_OUTCOME.NOT_SIGNED_IN }).code,
    "not-signed-in",
  );
  assert.equal(
    new QuotaExhaustedRefusal({ code: LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED }).code,
    "quota-exhausted",
  );
  assert.equal(
    new HostedUnavailableRefusal({ code: LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE }).code,
    "hosted-unavailable",
  );
});

test("each refusal's tag names its own class alone", () => {
  const tags = [
    new NoApiKeyRefusal({ code: LIVE_SESSION_OUTCOME.NO_API_KEY })._tag,
    new DisabledByFixtureRefusal({ code: LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE })._tag,
    new HttpErrorRefusal({ code: LIVE_SESSION_OUTCOME.HTTP_ERROR })._tag,
    new NetworkErrorRefusal({ code: LIVE_SESSION_OUTCOME.NETWORK_ERROR })._tag,
    new MalformedResponseRefusal({ code: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE })._tag,
    new SidebandFailedRefusal({ code: LIVE_SESSION_OUTCOME.SIDEBAND_FAILED })._tag,
    new NotSignedInRefusal({ code: LIVE_SESSION_OUTCOME.NOT_SIGNED_IN })._tag,
    new QuotaExhaustedRefusal({ code: LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED })._tag,
    new HostedUnavailableRefusal({ code: LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE })._tag,
  ];
  assert.equal(new Set(tags).size, LIVE_SESSION_REFUSALS.length);
});
