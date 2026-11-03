import { jsonSchemaGoldenRoot, settleJsonSchemaGolden } from "@repo/wire/testing";
import type { Schema } from "effect";
import { test } from "vitest";
import {
  inboxReadInputSchema,
  inboxThreadPostInputSchema,
  inboxWithdrawInputSchema,
} from "./inbox-wire.js";

/**
 * The schemas this package declares that a model is shown whole as a tool's
 * input: the coder's thread tools. A model
 * provider keys its prompt cache on the text of a request, so these bytes are
 * recorded and move only under `APP_UPDATE_FIXTURES=1`. A schema no model is
 * shown as a tool's input is not recorded.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const TOOL_INPUTS: readonly (readonly [string, Schema.Top])[] = [
  ["inbox-wire-inboxThreadPostInputSchema", inboxThreadPostInputSchema],
  ["inbox-wire-inboxWithdrawInputSchema", inboxWithdrawInputSchema],
  ["inbox-wire-inboxReadInputSchema", inboxReadInputSchema],
];

test.for(TOOL_INPUTS)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, schema);
});
