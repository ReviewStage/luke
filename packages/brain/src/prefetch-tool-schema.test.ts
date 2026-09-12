import {
  jsonSchemaGoldenRoot,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import { PLAN_READS_TOOL, PLAN_READS_TOOL_NAME } from "./tools/prefetch-tool.js";

/**
 * The planner's one tool as an inference is handed it, recorded whole. The
 * bytes travel on every prefetch, keyed and hosted alike, so a reworded
 * description or a widened bound is re-recorded under `LUKE_UPDATE_FIXTURES=1`
 * and the diff is what says the request changed.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const GOLDEN = `tool-${PLAN_READS_TOOL_NAME}`;

test(`${GOLDEN} emits the recorded JSON Schema`, async () => {
  await settleJsonSchemaGolden(ROOT, GOLDEN, {
    type: "function",
    name: PLAN_READS_TOOL.name,
    description: PLAN_READS_TOOL.description,
    parameters: PLAN_READS_TOOL.inputSchema.jsonSchema(),
  });
});

test("the recorded set is exactly the planner's tool", async () => {
  await settleJsonSchemaGoldenSet(ROOT, [GOLDEN]);
});
