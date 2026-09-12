import {
  jsonSchemaGoldenRoot,
  jsonSchemaOf,
  type RecordedEffectJsonSchemas,
  type RecordedJsonSchemaSource,
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

/**
 * The declared parameter and result shapes a client is shown, picked out of
 * the wider module by name: `protocol.ts` also declares the envelope shapes
 * (`GatewayRequestSchema` and the rest), the error refusal classes, and the
 * bare method vocabularies, none of which is a shape a client reads as JSON
 * Schema — the envelopes are pinned byte for byte by the exchange goldens
 * beside this file instead. The `Pick` is what keeps this file's own
 * exhaustiveness scoped to the shapes it has always recorded, so a new
 * parameter or result added to this named set still fails to compile
 * unrecorded, without sweeping in the rest of the module.
 */
type RecordedProtocolSchemas = Pick<
  typeof protocol,
  | "voiceCreateLiveSessionParamsSchema"
  | "voiceCreateLiveSessionResultSchema"
  | "voiceReportLiveTransportParamsSchema"
  | "voiceReportLiveActivityParamsSchema"
  | "voiceStopSpeakingResultSchema"
  | "voiceLiveSessionChangedSchema"
  | "conversationRateMessageParamsSchema"
  | "conversationRateMessageResultSchema"
>;

const SCHEMAS = {
  voiceCreateLiveSessionParamsSchema: protocol.voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema: protocol.voiceCreateLiveSessionResultSchema,
  voiceReportLiveTransportParamsSchema: protocol.voiceReportLiveTransportParamsSchema,
  voiceReportLiveActivityParamsSchema: protocol.voiceReportLiveActivityParamsSchema,
  voiceStopSpeakingResultSchema: protocol.voiceStopSpeakingResultSchema,
  voiceLiveSessionChangedSchema: protocol.voiceLiveSessionChangedSchema,
  conversationRateMessageParamsSchema: protocol.conversationRateMessageParamsSchema,
  conversationRateMessageResultSchema: protocol.conversationRateMessageResultSchema,
} satisfies RecordedEffectJsonSchemas<RecordedProtocolSchemas>;

const RECORDED: readonly (readonly [string, RecordedJsonSchemaSource])[] = Object.entries(SCHEMAS);

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, jsonSchemaOf(schema));
});

test("the recorded set is exactly the schemas the protocol declares", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
