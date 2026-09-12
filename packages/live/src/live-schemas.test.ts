import {
  jsonSchemaGoldenRoot,
  jsonSchemaOf,
  type RecordedEffectJsonSchemas,
  type RecordedJsonSchemaSource,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import * as events from "./events.js";
import * as session from "./session.js";

/**
 * What the live vocabulary parses, as the JSON Schema its declarations emit.
 * Each module's set is typed against the module itself, so a schema added
 * there does not compile until it is recorded here.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const MODULE_SCHEMAS = {
  events: {
    LiveStatusSchema: events.LiveStatusSchema,
    LiveClientEventTypeSchema: events.LiveClientEventTypeSchema,
    LiveServerEventTypeSchema: events.LiveServerEventTypeSchema,
    LiveCloseReasonSchema: events.LiveCloseReasonSchema,
    LiveDelegationTargetSchema: events.LiveDelegationTargetSchema,
    liveServerEventSchema: events.liveServerEventSchema,
  } satisfies RecordedEffectJsonSchemas<typeof events>,
  session: {
    LiveTransportTypeSchema: session.LiveTransportTypeSchema,
    LiveDelegationTypeSchema: session.LiveDelegationTypeSchema,
    liveCreateAnswerSchema: session.liveCreateAnswerSchema,
    NoApiKeyRefusal: session.NoApiKeyRefusal,
    DisabledByFixtureRefusal: session.DisabledByFixtureRefusal,
    HttpErrorRefusal: session.HttpErrorRefusal,
    NetworkErrorRefusal: session.NetworkErrorRefusal,
    MalformedResponseRefusal: session.MalformedResponseRefusal,
    SidebandFailedRefusal: session.SidebandFailedRefusal,
    NotSignedInRefusal: session.NotSignedInRefusal,
    QuotaExhaustedRefusal: session.QuotaExhaustedRefusal,
    HostedUnavailableRefusal: session.HostedUnavailableRefusal,
  } satisfies RecordedEffectJsonSchemas<typeof session>,
} as const;

const RECORDED: readonly (readonly [string, RecordedJsonSchemaSource])[] = Object.entries(
  MODULE_SCHEMAS,
).flatMap(([module, schemas]) =>
  Object.entries(schemas).map(([name, schema]) => [`${module}-${name}`, schema] as const),
);

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, jsonSchemaOf(schema));
});

test("the recorded set is exactly the schemas the live modules declare", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
