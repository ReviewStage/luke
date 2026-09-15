import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Result, Schema } from "effect";
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
import { LIVE_SCENE, LiveSceneSchema } from "./instructions.js";
import { PROACTIVE_SPEECH_KIND, ProactiveSpeechKindSchema } from "./proactive.js";
import {
  LIVE_DELEGATION_TYPE,
  LIVE_TRANSPORT_TYPE,
  LiveDelegationTypeSchema,
  LiveTransportTypeSchema,
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
  schema: Schema.Codec<Member>,
  members: readonly Member[],
  alsoRefused: readonly UnparsedWireValue[] = [],
): void {
  const decode = Schema.decodeUnknownResult(schema);
  for (const member of members) assert.deepEqual(decode(member), Result.succeed(member));
  for (const refused of [...NOTHING_ANY_VOCABULARY_HOLDS, ...alsoRefused]) {
    assert.equal(Result.isFailure(decode(refused)), true);
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
});

test("proactive speech is one of the kinds this build knows how to word", () => {
  settlesVocabulary(ProactiveSpeechKindSchema, Object.values(PROACTIVE_SPEECH_KIND));
});

test("a voice arriving from storage or IPC is a schema of the SDK's built-in set", () => {
  settlesVocabulary(LiveVoiceSchema, Object.values(LIVE_VOICE));
});
