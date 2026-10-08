import {
  jsonSchemaGoldenRoot,
  jsonSchemaOf,
  type RecordedEffectJsonSchemas,
  type RecordedJsonSchemaSource,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import * as boardWire from "./board-wire.js";
import * as liveContract from "./live-contract.js";
import * as planWire from "./plan-wire.js";
import * as serviceWire from "./service-wire.js";

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
  "board-wire": {
    boardElementSchema: boardWire.boardElementSchema,
    boardElementsSchema: boardWire.boardElementsSchema,
    boardSchema: boardWire.boardSchema,
    boardAnswerSchema: boardWire.boardAnswerSchema,
    boardSaveRequestSchema: boardWire.boardSaveRequestSchema,
    drawingElementsSchema: boardWire.drawingElementsSchema,
  } satisfies RecordedEffectJsonSchemas<typeof boardWire>,
  "live-contract": {
    sessionCreateFrameSchema: liveContract.sessionCreateFrameSchema,
    sessionAttachFrameSchema: liveContract.sessionAttachFrameSchema,
    sessionOpeningFrameSchema: liveContract.sessionOpeningFrameSchema,
    sessionActivityFrameSchema: liveContract.sessionActivityFrameSchema,
    sessionStopFrameSchema: liveContract.sessionStopFrameSchema,
    sessionHangUpFrameSchema: liveContract.sessionHangUpFrameSchema,
    sessionReportFrameSchema: liveContract.sessionReportFrameSchema,
    planDraftFrameSchema: liveContract.planDraftFrameSchema,
    planActivityFrameSchema: liveContract.planActivityFrameSchema,
    planCodeFrameSchema: liveContract.planCodeFrameSchema,
    sessionAttachedFrameSchema: liveContract.sessionAttachedFrameSchema,
    sessionCreatedFrameSchema: liveContract.sessionCreatedFrameSchema,
  } satisfies RecordedEffectJsonSchemas<typeof liveContract>,
  "plan-wire": {
    planAssumptionSchema: planWire.planAssumptionSchema,
    planDocumentSchema: planWire.planDocumentSchema,
    planCreateRequestSchema: planWire.planCreateRequestSchema,
    planSummarySchema: planWire.planSummarySchema,
    planSchema: planWire.planSchema,
    planListAnswerSchema: planWire.planListAnswerSchema,
    planAnswerSchema: planWire.planAnswerSchema,
    planCommandSchema: planWire.planCommandSchema,
    planCommandClaimAnswerSchema: planWire.planCommandClaimAnswerSchema,
    planCommandResultSchema: planWire.planCommandResultSchema,
    planCommandSettleAnswerSchema: planWire.planCommandSettleAnswerSchema,
    planDeleteAnswerSchema: planWire.planDeleteAnswerSchema,
    codeRefSchema: planWire.codeRefSchema,
  } satisfies RecordedEffectJsonSchemas<typeof planWire>,
  "service-wire": {
    writtenText: serviceWire.writtenText,
    countedNumber: serviceWire.countedNumber,
    hostedQuotaSchema: serviceWire.hostedQuotaSchema,
    hostedErrorSchema: serviceWire.hostedErrorSchema,
    wireUuidSchema: serviceWire.wireUuidSchema,
  } satisfies RecordedEffectJsonSchemas<typeof serviceWire>,
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
