import assert from "node:assert/strict";
import { NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { test } from "vitest";
import { BRAIN_TOOL } from "./names.js";
import {
  PLAN_READS_INPUT,
  PLAN_READS_MAXIMUM,
  PLAN_READS_TOOL,
  PLAN_READS_TOOL_NAME,
  PREFETCH_READ_KIND,
} from "./prefetch-tool.js";

test("the tool is named once, declares its schema, and names the two reads by the tools they become", () => {
  assert.equal(PLAN_READS_TOOL.name, PLAN_READS_TOOL_NAME);
  assert.equal(PLAN_READS_TOOL.inputSchema, PLAN_READS_INPUT);
  assert.equal(PREFETCH_READ_KIND.TRANSCRIPT, BRAIN_TOOL.READ_TRANSCRIPT);
  assert.equal(PREFETCH_READ_KIND.MEMORY, NOTEBOOK_MEMORY_TOOL.SEARCH);
  const node = emitJsonSchema(PLAN_READS_INPUT);
  assert.ok("required" in node);
  assert.deepEqual(node.required, ["reads"]);
  assert.equal(PLAN_READS_MAXIMUM, 2);
});
