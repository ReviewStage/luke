import {
  jsonSchemaGoldenRoot,
  jsonSchemaOf,
  type RecordedEffectJsonSchemas,
  type RecordedJsonSchemaSource,
  type RecordedJsonSchemas,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import * as actionWire from "./action-wire.js";
import * as brainContract from "./brain-contract.js";
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
import * as vaultWire from "./vault-wire.js";

/**
 * Every schema the hosted wire declares, as the JSON Schema it emits. The
 * hosted contract's own request schemas are what a model's tool call is
 * measured against on the service, so these bytes travel the same way a tool
 * definition's do, and each module's set is typed against the module itself:
 * a schema added there does not compile until it is recorded here.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

/** The registry a `s.registered` schema is built with, which its node never carries. */
const FIXTURE_TOOL_CATALOG: ReadonlySet<string> = new Set(["fixture_tool"]);

const MODULE_SCHEMAS = {
  "action-wire": {
    hostedActionAnswerSchema: actionWire.hostedActionAnswerSchema,
    hostedActionWorkspaceAnswerSchema: actionWire.hostedActionWorkspaceAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof actionWire>,
  "conversation-clear-wire": {
    conversationClearAnswerSchema: conversationClearWire.conversationClearAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof conversationClearWire>,
  "conversation-wire": {
    hostedConversationAnswerSchema: conversationWire.hostedConversationAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof conversationWire>,
  "device-wire": {
    deviceWireIdSchema: deviceWire.deviceWireIdSchema,
    deviceRegisterRequestSchema: deviceWire.deviceRegisterRequestSchema,
    deviceRegisterAnswerSchema: deviceWire.deviceRegisterAnswerSchema,
    deviceHeartbeatRequestSchema: deviceWire.deviceHeartbeatRequestSchema,
    deviceHeartbeatAnswerSchema: deviceWire.deviceHeartbeatAnswerSchema,
    deviceForgetRequestSchema: deviceWire.deviceForgetRequestSchema,
    deviceForgetAnswerSchema: deviceWire.deviceForgetAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof deviceWire>,
  "live-contract": {
    sessionCreateFrameSchema: liveContract.sessionCreateFrameSchema,
    sessionAttachFrameSchema: liveContract.sessionAttachFrameSchema,
    sessionOpeningFrameSchema: liveContract.sessionOpeningFrameSchema,
    sessionAttachedFrameSchema: liveContract.sessionAttachedFrameSchema,
    liveSessionCreatedSchema: liveContract.liveSessionCreatedSchema,
    sessionCreatedFrameSchema: liveContract.sessionCreatedFrameSchema,
  } satisfies RecordedJsonSchemas<typeof liveContract>,
  "mint-wire": {
    hostedMintAnswerSchema: mintWire.hostedMintAnswerSchema,
    remoteMintAnswerSchema: mintWire.remoteMintAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof mintWire>,
  "observe-wire": {
    observeAnswerSchema: observeWire.observeAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof observeWire>,
  "projects-wire": {
    hostedProjectsAnswerSchema: projectsWire.hostedProjectsAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof projectsWire>,
  "rating-wire": {
    hostedMessageRatingRequestSchema: ratingWire.hostedMessageRatingRequestSchema,
    hostedMessageRatingAnswerSchema: ratingWire.hostedMessageRatingAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof ratingWire>,
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
  } satisfies RecordedJsonSchemas<typeof readsWire>,
  "service-wire": {
    writtenText: serviceWire.writtenText,
    countedNumber: serviceWire.countedNumber,
    hostedQuotaSchema: serviceWire.hostedQuotaSchema,
    hostedErrorSchema: serviceWire.hostedErrorSchema,
    wireUuidSchema: serviceWire.wireUuidSchema,
  } satisfies RecordedJsonSchemas<typeof serviceWire>,
  "vault-wire": {
    vaultKeyStoreAnswerSchema: vaultWire.vaultKeyStoreAnswerSchema,
    vaultKeysListAnswerSchema: vaultWire.vaultKeysListAnswerSchema,
    vaultKeyDeleteAnswerSchema: vaultWire.vaultKeyDeleteAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof vaultWire>,
} as const;

/** The brain contract, which declares its schemas as Effect's own rather than through the builder. */
const EFFECT_MODULE_SCHEMAS = {
  "brain-contract": {
    hostedBrainCapabilitiesSchema: brainContract.hostedBrainCapabilitiesSchema,
    hostedBrainEmbedRequestSchema: brainContract.hostedBrainEmbedRequestSchema,
    hostedBrainEmbedAnswerSchema: brainContract.hostedBrainEmbedAnswerSchema,
    hostedBrainCountTokensAnswerSchema: brainContract.hostedBrainCountTokensAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof brainContract>,
} as const;

/**
 * The two the contract builds rather than declares: a request schema is made
 * against the tool catalog the other side registered, which the node it emits
 * never carries, so a synthetic catalog records the same bytes the service's
 * own does.
 */
const BUILT_SCHEMAS = [
  [
    "brain-contract-hostedBrainRespondRequestSchema",
    brainContract.hostedBrainRespondRequestSchema(FIXTURE_TOOL_CATALOG),
  ],
  [
    "brain-contract-hostedBrainCountTokensRequestSchema",
    brainContract.hostedBrainCountTokensRequestSchema(FIXTURE_TOOL_CATALOG),
  ],
] as const satisfies readonly (readonly [string, RecordedJsonSchemaSource])[];

const declaredSchemas = (
  modules: Readonly<Record<string, Readonly<Record<string, RecordedJsonSchemaSource>>>>,
): readonly (readonly [string, RecordedJsonSchemaSource])[] =>
  Object.entries(modules).flatMap(([module, schemas]) =>
    Object.entries(schemas).map(([name, schema]) => [`${module}-${name}`, schema] as const),
  );

const RECORDED: readonly (readonly [string, RecordedJsonSchemaSource])[] = [
  ...declaredSchemas(MODULE_SCHEMAS),
  ...declaredSchemas(EFFECT_MODULE_SCHEMAS),
  ...BUILT_SCHEMAS,
];

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, jsonSchemaOf(schema));
});

test("the recorded set is exactly the schemas the wire modules declare", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
