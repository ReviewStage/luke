import { jsonSchemaGoldenRoot, settleJsonSchemaGolden } from "@repo/wire/testing";
import type { Schema } from "effect";
import { test } from "vitest";
import {
  inboxReadInputSchema,
  inboxThreadPostInputSchema,
  inboxWithdrawInputSchema,
} from "./inbox-wire.js";

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const TOOL_INPUTS: readonly (readonly [string, Schema.Top])[] = [
  ["inbox-wire-inboxThreadPostInputSchema", inboxThreadPostInputSchema],
  ["inbox-wire-inboxWithdrawInputSchema", inboxWithdrawInputSchema],
  ["inbox-wire-inboxReadInputSchema", inboxReadInputSchema],
];

test.for(TOOL_INPUTS)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, schema);
});
