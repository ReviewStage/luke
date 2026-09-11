import {
  type JsonSchemaSource,
  jsonSchemaGoldenRoot,
  type RecordedJsonSchemas,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import * as protocol from "./protocol.js";

/**
 * The JSON Schema the protocol's own declared shapes emit. It is a different
 * measurement from the envelope goldens beside it: those record what crosses
 * the wire, and these record what the declarations say a shape is, which is
 * what a rewrite of the emitter moves.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const SCHEMAS = {
  voiceCreateLiveSessionParamsSchema: protocol.voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema: protocol.voiceCreateLiveSessionResultSchema,
  voiceReportLiveTransportParamsSchema: protocol.voiceReportLiveTransportParamsSchema,
  voiceReportLiveActivityParamsSchema: protocol.voiceReportLiveActivityParamsSchema,
  voiceStopSpeakingResultSchema: protocol.voiceStopSpeakingResultSchema,
  voiceLiveSessionChangedSchema: protocol.voiceLiveSessionChangedSchema,
  conversationRateMessageParamsSchema: protocol.conversationRateMessageParamsSchema,
  conversationRateMessageResultSchema: protocol.conversationRateMessageResultSchema,
} satisfies RecordedJsonSchemas<typeof protocol>;

const RECORDED: readonly (readonly [string, JsonSchemaSource])[] = Object.entries(SCHEMAS);

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, schema.jsonSchema());
});

test("the recorded set is exactly the schemas the protocol declares", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
