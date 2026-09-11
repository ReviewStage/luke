import assert from "node:assert/strict";
import { test } from "vitest";
import {
  type CheckpointFormat,
  checkpointFormatFromTag,
  checkpointFormatTag,
  sameCheckpointFormat,
} from "./execution.js";

const FORMAT: CheckpointFormat = {
  runtime: "tool-loop",
  runtimeVersion: 1,
  format: "openai-responses-input",
  formatVersion: 1,
};

test("a checkpoint format round-trips through its storage tag", () => {
  const tag = checkpointFormatTag(FORMAT);
  assert.equal(tag, "tool-loop@1:openai-responses-input/1");
  assert.deepEqual(checkpointFormatFromTag(tag), FORMAT);
});

test("compatibility needs the runtime, its version, the format, and its version all to match", () => {
  assert.ok(sameCheckpointFormat(FORMAT, { ...FORMAT }));
  assert.ok(!sameCheckpointFormat(FORMAT, { ...FORMAT, runtime: "other" }));
  assert.ok(!sameCheckpointFormat(FORMAT, { ...FORMAT, runtimeVersion: 2 }));
  assert.ok(!sameCheckpointFormat(FORMAT, { ...FORMAT, format: "other" }));
  assert.ok(!sameCheckpointFormat(FORMAT, { ...FORMAT, formatVersion: 2 }));
});

test("a tag not written by the rule reads as nothing", () => {
  for (const tag of ["", "openai-responses-input/1", "a@x:b/1", "a@1:b", "a@1:b/-1", 5, null]) {
    assert.equal(checkpointFormatFromTag(tag), undefined, JSON.stringify(tag));
  }
});
