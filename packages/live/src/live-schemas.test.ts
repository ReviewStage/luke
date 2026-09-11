import {
  type JsonSchemaSource,
  jsonSchemaGoldenRoot,
  type RecordedJsonSchemas,
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
    liveServerEventSchema: events.liveServerEventSchema,
  } satisfies RecordedJsonSchemas<typeof events>,
  session: {
    liveCreateAnswerSchema: session.liveCreateAnswerSchema,
  } satisfies RecordedJsonSchemas<typeof session>,
} as const;

const RECORDED: readonly (readonly [string, JsonSchemaSource])[] = Object.entries(
  MODULE_SCHEMAS,
).flatMap(([module, schemas]) =>
  Object.entries(schemas).map(([name, schema]) => [`${module}-${name}`, schema] as const),
);

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, schema.jsonSchema());
});

test("the recorded set is exactly the schemas the live modules declare", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
