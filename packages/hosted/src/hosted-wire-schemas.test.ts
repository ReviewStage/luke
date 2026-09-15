import {
  jsonSchemaGoldenRoot,
  jsonSchemaOf,
  type RecordedEffectJsonSchemas,
  type RecordedJsonSchemaSource,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import * as actionWire from "./action-wire.js";
import * as askWire from "./ask-wire.js";
import * as conversationClearWire from "./conversation-clear-wire.js";
import * as conversationWire from "./conversation-wire.js";
import * as deviceWire from "./device-wire.js";
import * as liveContract from "./live-contract.js";
import * as mintWire from "./mint-wire.js";
import * as observeWire from "./observe-wire.js";
import * as projectsWire from "./projects-wire.js";
import * as ratingWire from "./rating-wire.js";
import * as readsWire from "./reads-wire.js";
import * as serviceWire from "./service-wire.js";
import * as turnEventsWire from "./turn-events-wire.js";
import * as vaultWire from "./vault-wire.js";

/**
 * Every schema the hosted wire declares, as the JSON Schema it emits. A wire
 * schema's bytes are what a client and the service hold each other to, so
 * they are recorded the same way a tool definition's are, and each module's
 * set is typed against the module itself: a schema added there does not
 * compile until it is recorded here. Every module in this package declares
 * its schemas directly as Effect's own, so every set below is
 * `RecordedEffectJsonSchemas`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const EFFECT_MODULE_SCHEMAS = {
  "action-wire": {
    hostedActionAnswerSchema: actionWire.hostedActionAnswerSchema,
    hostedActionWorkspaceAnswerSchema: actionWire.hostedActionWorkspaceAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof actionWire>,
  "ask-wire": {
    hostedBrainAskRequestSchema: askWire.hostedBrainAskRequestSchema,
    hostedBrainAskAnswerSchema: askWire.hostedBrainAskAnswerSchema,
    hostedBrainTurnAnswerSchema: askWire.hostedBrainTurnAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof askWire>,
  "conversation-clear-wire": {
    conversationClearAnswerSchema: conversationClearWire.conversationClearAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof conversationClearWire>,
  "conversation-wire": {
    hostedConversationAnswerSchema: conversationWire.hostedConversationAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof conversationWire>,
  "device-wire": {
    deviceWireIdSchema: deviceWire.deviceWireIdSchema,
    deviceRegisterRequestSchema: deviceWire.deviceRegisterRequestSchema,
    deviceRegisterAnswerSchema: deviceWire.deviceRegisterAnswerSchema,
    deviceHeartbeatRequestSchema: deviceWire.deviceHeartbeatRequestSchema,
    deviceHeartbeatAnswerSchema: deviceWire.deviceHeartbeatAnswerSchema,
    deviceForgetRequestSchema: deviceWire.deviceForgetRequestSchema,
    deviceForgetAnswerSchema: deviceWire.deviceForgetAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof deviceWire>,
  "live-contract": {
    sessionCreateFrameSchema: liveContract.sessionCreateFrameSchema,
    sessionAudioCreateFrameSchema: liveContract.sessionAudioCreateFrameSchema,
    sessionAttachFrameSchema: liveContract.sessionAttachFrameSchema,
    sessionOpeningFrameSchema: liveContract.sessionOpeningFrameSchema,
    sessionActivityFrameSchema: liveContract.sessionActivityFrameSchema,
    sessionStopFrameSchema: liveContract.sessionStopFrameSchema,
    sessionBeatFrameSchema: liveContract.sessionBeatFrameSchema,
    sessionReportFrameSchema: liveContract.sessionReportFrameSchema,
    sessionSpokenFrameSchema: liveContract.sessionSpokenFrameSchema,
    sessionAttachedFrameSchema: liveContract.sessionAttachedFrameSchema,
    liveSessionCreatedSchema: liveContract.liveSessionCreatedSchema,
    sessionCreatedFrameSchema: liveContract.sessionCreatedFrameSchema,
    sessionAudioCreatedFrameSchema: liveContract.sessionAudioCreatedFrameSchema,
  } satisfies RecordedEffectJsonSchemas<typeof liveContract>,
  "mint-wire": {
    hostedMintAnswerSchema: mintWire.hostedMintAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof mintWire>,
  "observe-wire": {
    observeAnswerSchema: observeWire.observeAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof observeWire>,
  "projects-wire": {
    hostedProjectsAnswerSchema: projectsWire.hostedProjectsAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof projectsWire>,
  "service-wire": {
    writtenText: serviceWire.writtenText,
    countedNumber: serviceWire.countedNumber,
    hostedQuotaSchema: serviceWire.hostedQuotaSchema,
    hostedErrorSchema: serviceWire.hostedErrorSchema,
    wireUuidSchema: serviceWire.wireUuidSchema,
  } satisfies RecordedEffectJsonSchemas<typeof serviceWire>,
  "vault-wire": {
    vaultKeyStoreAnswerSchema: vaultWire.vaultKeyStoreAnswerSchema,
    vaultKeysListAnswerSchema: vaultWire.vaultKeysListAnswerSchema,
    vaultKeyDeleteAnswerSchema: vaultWire.vaultKeyDeleteAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof vaultWire>,
  "rating-wire": {
    hostedMessageRatingRequestSchema: ratingWire.hostedMessageRatingRequestSchema,
    hostedMessageRatingAnswerSchema: ratingWire.hostedMessageRatingAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof ratingWire>,
  "reads-wire": {
    sequenceReadCursorSchema: readsWire.sequenceReadCursorSchema,
    turnReadCursorSchema: readsWire.turnReadCursorSchema,
    readLimitSchema: readsWire.readLimitSchema,
    conversationMessagesAnswerSchema: readsWire.conversationMessagesAnswerSchema,
    conversationEventsAnswerSchema: readsWire.conversationEventsAnswerSchema,
    brainTurnsAnswerSchema: readsWire.brainTurnsAnswerSchema,
    changesRequestSchema: readsWire.changesRequestSchema,
    changesAnswerSchema: readsWire.changesAnswerSchema,
    unreadableRowRefusalSchema: readsWire.unreadableRowRefusalSchema,
  } satisfies RecordedEffectJsonSchemas<typeof readsWire>,
  "turn-events-wire": {
    turnEventCursorSchema: turnEventsWire.turnEventCursorSchema,
    turnEventSchema: turnEventsWire.turnEventSchema,
  } satisfies RecordedEffectJsonSchemas<typeof turnEventsWire>,
} as const;

const declaredSchemas = (
  modules: Readonly<Record<string, Readonly<Record<string, RecordedJsonSchemaSource>>>>,
): readonly (readonly [string, RecordedJsonSchemaSource])[] =>
  Object.entries(modules).flatMap(([module, schemas]) =>
    Object.entries(schemas).map(([name, schema]) => [`${module}-${name}`, schema] as const),
  );

const RECORDED: readonly (readonly [string, RecordedJsonSchemaSource])[] =
  declaredSchemas(EFFECT_MODULE_SCHEMAS);

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, jsonSchemaOf(schema));
});

test("the recorded set is exactly the schemas the wire modules declare", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
